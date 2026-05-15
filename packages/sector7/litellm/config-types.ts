import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

export type LiteLLMModelMode = "chat" | "completion" | "embedding";

export interface LiteLLMProviderConfig {
  apiKey: pulumi.Input<string>;
  envVar?: string;
  apiBase?: string;
}

export interface LiteLLMModelDeployment {
  id: string;
  modelName: string;
  provider: string;
  providerModel: string;
  apiBase?: string;
  mode?: LiteLLMModelMode;
  baseModel?: string;
  accessGroups?: string[];
  rpm?: number;
  tpm?: number;
  weight?: number;
  order?: number;
  maxInputTokens?: number;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
}

export interface LiteLLMModelGroup {
  name: string;
  deploymentIds: string[];
  fallbacks?: string[];
  contextWindowFallbacks?: string[];
  accessGroups?: string[];
}

export interface LiteLLMObservabilityPolicy {
  dropParams?: boolean;
  requestTimeout?: number;
  turnOffMessageLogging?: boolean;
  redactUserApiKeyInfo?: boolean;
  successCallbacks?: string[];
  failureCallbacks?: string[];
  serviceCallbacks?: string[];
}

export interface LiteLLMGovernancePolicy {
  enforceUserParam?: boolean;
  tokenRateLimitType?: "input" | "output" | "total";
  databaseConnectionPoolLimit?: number;
  allowRequestsOnDbUnavailable?: boolean;
  globalMaxParallelRequests?: number;
  maxBudget?: number;
  budgetDuration?: string;
  upperboundKeyGenerateParams?: Record<string, number | string | boolean>;
  defaultKeyGenerateParams?: Record<string, string | number | boolean | string[]>;
}

export interface LiteLLMRedisPolicy {
  host: string;
  port?: number;
  maxConnections?: number;
  supportedCallTypes?: string[];
  useRedisTransactionBuffer?: boolean;
}

export interface LiteLLMRouterPolicy {
  routingStrategy?:
    | "simple-shuffle"
    | "least-busy"
    | "latency-based-routing"
    | "usage-based-routing-v2"
    | "cost-based-routing";
  enablePreCallChecks?: boolean;
  allowedFails?: number;
  cooldownTime?: number;
  numRetries?: number;
  retryPolicy?: Record<string, number>;
  defaultFallbacks?: string[];
}

export interface LiteLLMServiceSpec {
  type?: "ClusterIP" | "NodePort" | "LoadBalancer";
  port?: number;
}

export interface LiteLLMProxyArgs {
  namespace?: pulumi.Input<string>;
  createNamespace?: boolean;
  image?: pulumi.Input<string>;
  replicas?: number;
  databaseUrl: pulumi.Input<string>;
  masterKey?: pulumi.Input<string>;
  providers: Record<string, LiteLLMProviderConfig>;
  deployments: LiteLLMModelDeployment[];
  modelGroups: LiteLLMModelGroup[];
  router?: LiteLLMRouterPolicy;
  governance?: LiteLLMGovernancePolicy;
  observability?: LiteLLMObservabilityPolicy;
  redis?: LiteLLMRedisPolicy;
  service?: LiteLLMServiceSpec;
  resources?: k8s.types.input.core.v1.ResourceRequirements;
}

export interface LiteLLMGeneratedConfig {
  configYaml: string;
  providerEnvVars: string[];
}
