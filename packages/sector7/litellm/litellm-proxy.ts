import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { generateLiteLLMConfig, getProviderEnvVar } from "./config.ts";
import type {
  LiteLLMModelDeployment,
  LiteLLMProxyArgs,
  LiteLLMProviderConfig,
} from "./config-types.ts";

type ResolvedProvider = {
  name: string;
  apiKey: string;
  envVar: string;
  apiBase?: string;
};

type ResolvedDeployment = Omit<LiteLLMModelDeployment, "apiBase"> & {
  apiBase?: string;
};

function toSecretKey(envVar: string): string {
  return envVar.toLowerCase();
}

function resolveProvider(providerName: string, provider: LiteLLMProviderConfig): pulumi.Output<ResolvedProvider> {
  return pulumi
    .all([provider.apiKey, pulumi.output(provider.envVar), pulumi.output(provider.apiBase)])
    .apply(([apiKey, envVar, apiBase]) => {
      const resolvedEnvVar = getProviderEnvVar(providerName, { apiKey, envVar: envVar ?? undefined });
      return {
        name: providerName,
        apiKey,
        envVar: resolvedEnvVar,
        apiBase: apiBase ?? undefined,
      };
    });
}
function resolveDeployment(deployment: LiteLLMModelDeployment): pulumi.Output<ResolvedDeployment> {
  return pulumi.output(deployment.apiBase).apply((apiBase) => ({
    ...deployment,
    apiBase: apiBase ?? undefined,
  }));
}

export class LiteLLMProxy extends pulumi.ComponentResource {
  public readonly namespaceResource: k8s.core.v1.Namespace | undefined;
  public readonly providerSecret: k8s.core.v1.Secret;
  public readonly runtimeSecret: k8s.core.v1.Secret;
  public readonly configMap: k8s.core.v1.ConfigMap;
  public readonly deployment: k8s.apps.v1.Deployment;
  public readonly service: k8s.core.v1.Service;
  public readonly namespace: pulumi.Output<string>;
  public readonly proxyUrl: pulumi.Output<string>;
  public readonly masterKey: pulumi.Output<string>;
  public readonly configYaml: pulumi.Output<string>;

  constructor(name: string, args: LiteLLMProxyArgs, opts?: pulumi.ComponentResourceOptions) {
    super("sector7:kubernetes:LiteLLMProxy", name, args, opts);

    const createNamespace = args.createNamespace ?? true;
    const namespaceName = pulumi.output(args.namespace ?? name);
    const image = args.image ?? "ghcr.io/berriai/litellm-database:main-stable";
    const replicas = pulumi.output(args.replicas ?? 1);
    const servicePort = args.service?.port ?? 4000;

    const resolvedProviders = pulumi.all(
      Object.entries(args.providers).map(([providerName, provider]) => resolveProvider(providerName, provider)),
    );
    const resolvedDeployments = pulumi.all(args.deployments.map((deployment) => resolveDeployment(deployment)));

    const providerSecretName = `${name}-provider-keys`;

    const runtimeConfig = pulumi.all([resolvedProviders, resolvedDeployments, replicas]).apply(
      ([providers, deployments, resolvedReplicas]) => {
        const providerMap = Object.fromEntries(
          providers.map((provider) => [provider.name, {
            apiKey: provider.apiKey,
            envVar: provider.envVar,
            apiBase: provider.apiBase,
          }]),
        );

        const generatedConfig = generateLiteLLMConfig({
          providers: providerMap,
          deployments,
          modelGroups: args.modelGroups,
          observability: args.observability,
          governance: args.governance,
          redis: args.redis,
          router: args.router,
          replicas: resolvedReplicas,
        });

        return {
          configYaml: generatedConfig.configYaml,
          providerStringData: Object.fromEntries(
            providers.map((provider) => [toSecretKey(provider.envVar), provider.apiKey]),
          ),
          providerEnvEntries: providers.map((provider) => ({
            name: provider.envVar,
            valueFrom: {
              secretKeyRef: {
                name: providerSecretName,
                key: toSecretKey(provider.envVar),
              },
            },
          })),
        };
      },
    );

    this.configYaml = runtimeConfig.apply((value) => value.configYaml);

    this.namespaceResource = createNamespace
      ? new k8s.core.v1.Namespace(
          `${name}-ns`,
          {
            metadata: {
              name: namespaceName,
              labels: {
                "app.kubernetes.io/name": "litellm",
                "app.kubernetes.io/component": "proxy",
                "app.kubernetes.io/managed-by": "pulumi",
              },
            },
          },
          { ...opts, parent: this },
        )
      : undefined;

    this.namespace = this.namespaceResource?.metadata.name ?? namespaceName;

    const parentAndProvider = { ...opts, parent: this };

    this.providerSecret = new k8s.core.v1.Secret(
      `${name}-providers`,
      {
        metadata: {
          name: providerSecretName,
          namespace: this.namespace,
        },
        stringData: runtimeConfig.apply((value) => value.providerStringData),
      },
      parentAndProvider,
    );

    const generatedMasterKey = new random.RandomPassword(
      `${name}-master-key`,
      {
        length: 32,
        special: false,
      },
      { parent: this },
    ).result;
    this.masterKey = pulumi.secret(pulumi.output(args.masterKey ?? generatedMasterKey));

    this.runtimeSecret = new k8s.core.v1.Secret(
      `${name}-runtime`,
      {
        metadata: {
          name: `${name}-runtime`,
          namespace: this.namespace,
        },
        stringData: pulumi.all([this.masterKey, args.databaseUrl]).apply(([masterKey, databaseUrl]) => ({
          LITELLM_MASTER_KEY: masterKey,
          DATABASE_URL: databaseUrl,
        })),
      },
      parentAndProvider,
    );

    this.configMap = new k8s.core.v1.ConfigMap(
      `${name}-config`,
      {
        metadata: {
          name: `${name}-config`,
          namespace: this.namespace,
        },
        data: {
          "config.yaml": this.configYaml,
        },
      },
      parentAndProvider,
    );

    const appLabels = {
      "app.kubernetes.io/name": "litellm",
      "app.kubernetes.io/component": "proxy",
      "app.kubernetes.io/instance": name,
    };

    const env = pulumi.all([runtimeConfig, this.runtimeSecret.metadata.name]).apply(
      ([value, runtimeSecretName]) => [
        {
          name: "LITELLM_MASTER_KEY",
          valueFrom: {
            secretKeyRef: {
              name: runtimeSecretName,
              key: "LITELLM_MASTER_KEY",
            },
          },
        },
        {
          name: "DATABASE_URL",
          valueFrom: {
            secretKeyRef: {
              name: runtimeSecretName,
              key: "DATABASE_URL",
            },
          },
        },
        ...value.providerEnvEntries,
      ],
    );

    this.deployment = new k8s.apps.v1.Deployment(
      `${name}-deployment`,
      {
        metadata: {
          name,
          namespace: this.namespace,
          labels: appLabels,
        },
        spec: {
          replicas,
          selector: {
            matchLabels: appLabels,
          },
          template: {
            metadata: {
              labels: appLabels,
            },
            spec: {
              containers: [
                {
                  name: "litellm",
                  image,
                  args: ["--config", "/app/config.yaml"],
                  ports: [{ containerPort: servicePort }],
                  env,
                  volumeMounts: [
                    {
                      name: "config-volume",
                      mountPath: "/app/config.yaml",
                      subPath: "config.yaml",
                      readOnly: true,
                    },
                  ],
                  livenessProbe: {
                    httpGet: { path: "/health/liveliness", port: servicePort },
                    initialDelaySeconds: 180,
                    periodSeconds: 15,
                    timeoutSeconds: 10,
                    failureThreshold: 3,
                  },
                  readinessProbe: {
                    httpGet: { path: "/health/readiness", port: servicePort },
                    initialDelaySeconds: 30,
                    periodSeconds: 15,
                    timeoutSeconds: 10,
                    failureThreshold: 3,
                  },
                  resources: args.resources ?? {
                    requests: { cpu: "250m", memory: "512Mi" },
                    limits: { cpu: "1", memory: "2Gi" },
                  },
                },
              ],
              volumes: [
                {
                  name: "config-volume",
                  configMap: {
                    name: this.configMap.metadata.name,
                  },
                },
              ],
            },
          },
        },
      },
      parentAndProvider,
    );

    this.service = new k8s.core.v1.Service(
      `${name}-service`,
      {
        metadata: {
          name,
          namespace: this.namespace,
          labels: appLabels,
        },
        spec: {
          type: args.service?.type ?? "ClusterIP",
          selector: appLabels,
          ports: [
            {
              name: "http",
              port: servicePort,
              targetPort: servicePort,
              protocol: "TCP",
            },
          ],
        },
      },
      parentAndProvider,
    );

    this.proxyUrl = pulumi.interpolate`http://${this.service.metadata.name}.${this.namespace}.svc.cluster.local:${servicePort}`;

    this.registerOutputs({
      namespace: this.namespace,
      proxyUrl: this.proxyUrl,
      masterKey: this.masterKey,
      configYaml: this.configYaml,
      serviceName: this.service.metadata.name,
    });
  }
}
