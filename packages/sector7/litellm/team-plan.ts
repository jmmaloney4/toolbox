import type {
	BuildLiteLLMTeamScopedModelGroupsArgs,
	LiteLLMModelGroup,
	LiteLLMTeamDefinition,
} from "./config-types.ts";

const DEFAULT_SEPARATOR = "::";

function toInternalModelGroupName(
	team: LiteLLMTeamDefinition,
	capabilityName: string,
	separator: string,
): string {
	return `${team.id}${separator}${capabilityName}`;
}

export function buildLiteLLMTeamScopedModelGroups(
	args: BuildLiteLLMTeamScopedModelGroupsArgs,
): LiteLLMModelGroup[] {
	const separator = args.separator ?? DEFAULT_SEPARATOR;
	const groups: LiteLLMModelGroup[] = [];
	const internalNames = new Set<string>();

	for (const team of args.teams) {
		const capabilityNames = new Set<string>();
		for (const capability of team.capabilities) {
			if (capabilityNames.has(capability.name)) {
				throw new Error(
					`Duplicate capability '${capability.name}' for LiteLLM team '${team.id}'`,
				);
			}
			capabilityNames.add(capability.name);
		}

		for (const capability of team.capabilities) {
			const internalName = toInternalModelGroupName(
				team,
				capability.name,
				separator,
			);
			if (internalNames.has(internalName)) {
				throw new Error(
					`Duplicate internal LiteLLM model group '${internalName}'`,
				);
			}
			internalNames.add(internalName);

			groups.push({
				name: internalName,
				deploymentIds: capability.deploymentIds,
				fallbacks: capability.fallbacks?.map((fallback) =>
					toInternalModelGroupName(team, fallback, separator),
				),
				contextWindowFallbacks: capability.contextWindowFallbacks?.map(
					(fallback) => toInternalModelGroupName(team, fallback, separator),
				),
				accessGroups: capability.accessGroups,
				teamId: team.id,
				teamAlias: team.alias,
				teamPublicModelName: capability.name,
				tags: capability.tags,
				extraModelInfo: capability.extraModelInfo,
			});
		}
	}

	return groups;
}
