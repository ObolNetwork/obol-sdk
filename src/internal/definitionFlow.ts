import type { ClusterDefinition } from './types.js';

/** Flow a cluster definition was created with, read from which fields are signed. */
export enum DefinitionFlow {
  Group = 'LP-Group',
  Solo = 'LP-Solo',
  Charon = 'Charon-Command',
}

/**
 * Group: creator and every operator signed. Solo: only the creator signed,
 * operators carry ENRs only. Charon: nothing signed (`charon create cluster`).
 * Returns null for any other combination.
 */
export const definitionFlow = (
  clusterDefinition: ClusterDefinition,
): DefinitionFlow | null => {
  if (
    clusterDefinition.creator.address &&
    clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every(operator => {
      return (
        operator.address &&
        operator.config_signature &&
        operator.enr &&
        operator.enr_signature
      );
    })
  ) {
    return DefinitionFlow.Group;
  } else if (
    clusterDefinition.creator.address &&
    clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every(operator => {
      return (
        !operator.address &&
        !operator.config_signature &&
        operator.enr &&
        !operator.enr_signature
      );
    })
  ) {
    return DefinitionFlow.Solo;
  } else if (
    !clusterDefinition.creator.address &&
    !clusterDefinition.creator.config_signature &&
    clusterDefinition.operators.every(operator => {
      return (
        !operator.address &&
        !operator.config_signature &&
        operator.enr &&
        !operator.enr_signature
      );
    })
  ) {
    return DefinitionFlow.Charon;
  }
  return null;
};
