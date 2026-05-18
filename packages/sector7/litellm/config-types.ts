import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";

export type LiteLLMModelMode =
	| "chat"
	| "completion"
	| "embedding"
	| "image_generation"
	| "audio_transcription"
	| "audio_speech"
	| "rerank";

export interface LiteLLMProviderConfig {
	apiKey?: pulumi.Input<string>;
	envVar?: pulumi.Input<string>;
	apiBase?: pulumi.Input<string>;
}

export interface LiteLLMModelDeployment {
	id: string;
	provider: string;
	providerModel: string;
	apiBase?: pulumi.Input<string>;
	mode?: LiteLLMModelMode;
	baseModel?: string;
	accessGroups?: string[];
	teamId?: string;
	teamAlias?: string;
	teamPublicModelName?: string;
	tags?: string[];
	extraLiteLLMParams?: Record<string, unknown>;
	extraModelInfo?: Record<string, unknown>;
	rpm?: number;
	tpm?: number;
	rpd?: number;
	tpd?: number;
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
	teamId?: string;
	teamAlias?: string;
	teamPublicModelName?: string;
	tags?: string[];
	extraModelInfo?: Record<string, unknown>;
}

export interface LiteLLMTeamCapability {
	name: string;
	deploymentIds: string[];
	fallbacks?: string[];
	contextWindowFallbacks?: string[];
	accessGroups?: string[];
	tags?: string[];
	extraModelInfo?: Record<string, unknown>;
}

export interface LiteLLMTeamDefinition {
	id: string;
	alias?: string;
	capabilities: LiteLLMTeamCapability[];
}

export interface BuildLiteLLMTeamScopedModelGroupsArgs {
	teams: LiteLLMTeamDefinition[];
	separator?: string;
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
	defaultKeyGenerateParams?: Record<
		string,
		string | number | boolean | string[]
	>;
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
	replicas?: pulumi.Input<number>;
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
	extraLiteLLMSettings?: Record<string, unknown>;
	extraGeneralSettings?: Record<string, unknown>;
	extraRouterSettings?: Record<string, unknown>;
}

export interface LiteLLMGeneratedConfig {
	configYaml: string;
	providerEnvVars: string[];
}

export interface LiteLLMAdminTargetArgs {
	proxyNamespace: pulumi.Input<string>;
	masterKey: pulumi.Input<string>;
	proxyDeploymentName?: pulumi.Input<string>;
	proxyPort?: pulumi.Input<number>;
}

export interface LiteLLMApiKeyArgs extends LiteLLMAdminTargetArgs {
	keyAlias: pulumi.Input<string>;
	models?: pulumi.Input<pulumi.Input<string>[]>;
	teamId?: pulumi.Input<string>;
	userId?: pulumi.Input<string>;
	budgetId?: pulumi.Input<string>;
	maxBudget?: pulumi.Input<number>;
	budgetDuration?: pulumi.Input<string>;
	duration?: pulumi.Input<string>;
	aliases?: pulumi.Input<Record<string, pulumi.Input<string>>>;
	tags?: pulumi.Input<pulumi.Input<string>[]>;
	metadata?: pulumi.Input<Record<string, pulumi.Input<string>>>;
}

export interface LiteLLMTeamArgs extends LiteLLMAdminTargetArgs {
	teamAlias: pulumi.Input<string>;
	teamId?: pulumi.Input<string>;
	models?: pulumi.Input<pulumi.Input<string>[]>;
	maxBudget?: pulumi.Input<number>;
	budgetDuration?: pulumi.Input<string>;
	tags?: pulumi.Input<pulumi.Input<string>[]>;
	metadata?: pulumi.Input<Record<string, pulumi.Input<string>>>;
}
