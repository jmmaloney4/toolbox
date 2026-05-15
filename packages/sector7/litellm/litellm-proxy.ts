import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import {
  generateLiteLLMConfig,
  getProviderEnvVar,
} from "./config.ts";
import type {
  LiteLLMProxyArgs,
  LiteLLMProviderConfig,
} from "./config-types.ts";

function toSecretKey(envVar: string): string {
  return envVar.toLowerCase();
}

function buildProviderStringData(
  providers: Record<string, LiteLLMProviderConfig>,
): pulumi.Output<Record<string, string>> {
  const entries = Object.entries(providers);
  return pulumi.all(entries.map(([, provider]) => provider.apiKey)).apply((values) =>
    Object.fromEntries(
      entries.map(([providerName, provider], index) => {
        const envVar = getProviderEnvVar(providerName, provider);
        return [toSecretKey(envVar), values[index] as string];
      }),
    ),
  );
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
    const replicas = args.replicas ?? 1;
    const servicePort = args.service?.port ?? 4000;

    const generatedConfig = generateLiteLLMConfig({
      providers: args.providers,
      deployments: args.deployments,
      modelGroups: args.modelGroups,
      observability: args.observability,
      governance: args.governance,
      redis: args.redis,
      router: args.router,
      replicas,
    });

    this.configYaml = pulumi.output(generatedConfig.configYaml);

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
          name: `${name}-provider-keys`,
          namespace: this.namespace,
        },
        stringData: buildProviderStringData(args.providers),
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
    this.masterKey = pulumi.output(args.masterKey ?? generatedMasterKey);

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

    const env = [
      {
        name: "LITELLM_MASTER_KEY",
        valueFrom: {
          secretKeyRef: {
            name: this.runtimeSecret.metadata.name,
            key: "LITELLM_MASTER_KEY",
          },
        },
      },
      {
        name: "DATABASE_URL",
        valueFrom: {
          secretKeyRef: {
            name: this.runtimeSecret.metadata.name,
            key: "DATABASE_URL",
          },
        },
      },
      ...Object.entries(args.providers).map(([providerName, provider]) => {
        const envVar = getProviderEnvVar(providerName, provider);
        return {
          name: envVar,
          valueFrom: {
            secretKeyRef: {
              name: this.providerSecret.metadata.name,
              key: toSecretKey(envVar),
            },
          },
        };
      }),
    ];

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
                    initialDelaySeconds: 120,
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
