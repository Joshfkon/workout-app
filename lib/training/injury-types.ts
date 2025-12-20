/**
 * Injury Type Definitions for Enhanced Exercise Safety
 *
 * Defines formal injury types with movement restrictions for intelligent
 * exercise filtering and substitution recommendations.
 */

import type { MuscleGroup } from '@/types/schema';
import type { SpinalLoading, PositionStress } from '@/services/exerciseService';

/**
 * Injury severity levels
 * - mild: Slight discomfort, can still train with modifications
 * - moderate: Noticeable pain, requires significant modifications
 * - severe: Significant pain, avoid all stress to area
 */
export type InjurySeverity = 'mild' | 'moderate' | 'severe';

/**
 * Movement restrictions for an injury type
 */
export interface InjuryMovementRestrictions {
  /** Avoid spinal flexion movements (crunches, situps) */
  spinalFlexion?: boolean;
  /** Avoid spinal extension movements (back extensions, deadlifts) */
  spinalExtension?: boolean;
  /** Avoid spinal rotation (Russian twists, woodchops) */
  spinalRotation?: boolean;
  /** Avoid exercises with this level of spinal loading or higher */
  spinalLoading?: SpinalLoading[];
  /** Avoid exercises requiring back arch (bench press, hip thrust) */
  backArch?: boolean;
}

/**
 * Formal injury type definition
 */
export interface InjuryType {
  /** Unique identifier for this injury type */
  id: string;
  /** Display name */
  name: string;
  /** Short description for UI */
  description: string;
  /** Muscle groups directly affected by this injury */
  affectedAreas: MuscleGroup[];
  /** Movement patterns to avoid */
  avoidMovements: InjuryMovementRestrictions;
  /** Body positions that stress the injured area */
  avoidPositionStress: (keyof PositionStress)[];
  /** Default severity level for this injury */
  defaultSeverity: InjurySeverity;
  /** Common questions to ask the user for this injury type */
  followUpQuestions?: InjuryFollowUpQuestion[];
}

/**
 * Follow-up question for injury customization
 */
export interface InjuryFollowUpQuestion {
  id: string;
  question: string;
  /** If true, add this movement restriction */
  ifYes: Partial<InjuryMovementRestrictions>;
}

/**
 * User's active injury with custom configuration
 */
export interface UserInjury {
  /** Unique ID for this injury instance */
  id: string;
  /** Reference to INJURY_TYPES */
  injuryTypeId: string;
  /** User's own description */
  customDescription?: string;
  /** Which side is affected (for bilateral injuries) */
  affectedSide?: 'left' | 'right' | 'both';
  /** User-selected severity */
  severity: InjurySeverity;
  /** When the injury started */
  startDate: Date;
  /** Estimated recovery date (optional) */
  estimatedRecovery?: Date;
  /** Is this injury currently active */
  isActive: boolean;
  /** Additional notes */
  notes?: string;
  /** Custom movement restrictions from follow-up questions */
  customRestrictions?: InjuryMovementRestrictions;
}

/**
 * Common injury types with detailed restrictions
 */
export const INJURY_TYPES: InjuryType[] = [
  // === BACK INJURIES ===
  {
    id: 'lower_back_strain',
    name: 'Lower Back Strain/Pull',
    description: 'Muscle strain in the lower back (lumbar) region',
    affectedAreas: ['back'],
    avoidMovements: {
      spinalLoading: ['moderate', 'high'],
      spinalExtension: true,
      backArch: true,
    },
    avoidPositionStress: ['lowerBack'],
    defaultSeverity: 'moderate',
    followUpQuestions: [
      {
        id: 'flexion',
        question: 'Does bending forward aggravate the pain?',
        ifYes: { spinalFlexion: true },
      },
      {
        id: 'rotation',
        question: 'Does twisting aggravate the pain?',
        ifYes: { spinalRotation: true },
      },
    ],
  },
  {
    id: 'herniated_disc',
    name: 'Herniated/Bulging Disc',
    description: 'Disc herniation in the spine',
    affectedAreas: ['back'],
    avoidMovements: {
      spinalLoading: ['moderate', 'high'],
      spinalFlexion: true,
      spinalExtension: true,
      spinalRotation: true,
      backArch: true,
    },
    avoidPositionStress: ['lowerBack', 'upperBack'],
    defaultSeverity: 'severe',
  },
  {
    id: 'sciatica',
    name: 'Sciatica',
    description: 'Pain radiating along the sciatic nerve',
    affectedAreas: ['back', 'glutes', 'hamstrings'],
    avoidMovements: {
      spinalLoading: ['high'],
      spinalFlexion: true,
    },
    avoidPositionStress: ['lowerBack'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'upper_back_strain',
    name: 'Upper Back Strain',
    description: 'Muscle strain in the thoracic (upper back) region',
    affectedAreas: ['back'],
    avoidMovements: {},
    avoidPositionStress: ['upperBack'],
    defaultSeverity: 'mild',
  },

  // === SHOULDER INJURIES ===
  {
    id: 'shoulder_impingement',
    name: 'Shoulder Impingement',
    description: 'Pinching of rotator cuff tendons in the shoulder',
    affectedAreas: ['shoulders'],
    avoidMovements: {},
    avoidPositionStress: ['shoulders'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'rotator_cuff_strain',
    name: 'Rotator Cuff Strain',
    description: 'Strain or tear of rotator cuff muscles',
    affectedAreas: ['shoulders'],
    avoidMovements: {},
    avoidPositionStress: ['shoulders'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'shoulder_instability',
    name: 'Shoulder Instability/Dislocation History',
    description: 'History of shoulder dislocations or subluxations',
    affectedAreas: ['shoulders'],
    avoidMovements: {},
    avoidPositionStress: ['shoulders'],
    defaultSeverity: 'moderate',
  },

  // === KNEE INJURIES ===
  {
    id: 'knee_injury',
    name: 'Knee Injury (General)',
    description: 'General knee pain or injury',
    affectedAreas: ['quads', 'hamstrings'],
    avoidMovements: {},
    avoidPositionStress: ['knees'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'patellofemoral',
    name: 'Patellofemoral Syndrome',
    description: 'Pain behind or around the kneecap',
    affectedAreas: ['quads'],
    avoidMovements: {},
    avoidPositionStress: ['knees'],
    defaultSeverity: 'mild',
  },
  {
    id: 'meniscus_tear',
    name: 'Meniscus Tear/Injury',
    description: 'Damage to the meniscus cartilage',
    affectedAreas: ['quads', 'hamstrings'],
    avoidMovements: {},
    avoidPositionStress: ['knees'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'acl_injury',
    name: 'ACL Injury/Surgery',
    description: 'Anterior cruciate ligament injury or post-surgery',
    affectedAreas: ['quads', 'hamstrings'],
    avoidMovements: {},
    avoidPositionStress: ['knees'],
    defaultSeverity: 'severe',
  },

  // === ARM INJURIES ===
  {
    id: 'elbow_tendinitis',
    name: 'Elbow Tendinitis (Tennis/Golfers Elbow)',
    description: 'Tendinitis on outer or inner elbow',
    affectedAreas: ['biceps', 'triceps'],
    avoidMovements: {},
    avoidPositionStress: ['elbows'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'wrist_strain',
    name: 'Wrist Strain',
    description: 'Strain or pain in the wrist',
    affectedAreas: [],
    avoidMovements: {},
    avoidPositionStress: ['wrists'],
    defaultSeverity: 'mild',
  },
  {
    id: 'carpal_tunnel',
    name: 'Carpal Tunnel Syndrome',
    description: 'Nerve compression in the wrist',
    affectedAreas: [],
    avoidMovements: {},
    avoidPositionStress: ['wrists'],
    defaultSeverity: 'moderate',
  },

  // === HIP INJURIES ===
  {
    id: 'hip_flexor_strain',
    name: 'Hip Flexor Strain',
    description: 'Strain of the hip flexor muscles',
    affectedAreas: ['quads', 'glutes'],
    avoidMovements: {},
    avoidPositionStress: ['hips'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'hip_impingement',
    name: 'Hip Impingement (FAI)',
    description: 'Femoroacetabular impingement',
    affectedAreas: ['glutes', 'quads'],
    avoidMovements: {},
    avoidPositionStress: ['hips'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'hip_bursitis',
    name: 'Hip Bursitis',
    description: 'Inflammation of the hip bursa',
    affectedAreas: ['glutes'],
    avoidMovements: {},
    avoidPositionStress: ['hips'],
    defaultSeverity: 'moderate',
  },

  // === NECK INJURIES ===
  {
    id: 'neck_strain',
    name: 'Neck Strain',
    description: 'Strain or pain in the neck (cervical spine)',
    affectedAreas: [],
    avoidMovements: {},
    avoidPositionStress: ['neck'],
    defaultSeverity: 'moderate',
  },
  {
    id: 'cervical_disc',
    name: 'Cervical Disc Issue',
    description: 'Disc herniation or degeneration in the neck',
    affectedAreas: [],
    avoidMovements: {
      spinalExtension: true,
    },
    avoidPositionStress: ['neck', 'upperBack'],
    defaultSeverity: 'severe',
  },

  // === ANKLE INJURIES ===
  {
    id: 'ankle_sprain',
    name: 'Ankle Sprain',
    description: 'Sprained or rolled ankle',
    affectedAreas: ['calves'],
    avoidMovements: {},
    avoidPositionStress: [],
    defaultSeverity: 'moderate',
  },
];

/**
 * Get injury type by ID
 */
export function getInjuryType(id: string): InjuryType | undefined {
  return INJURY_TYPES.find((type) => type.id === id);
}

/**
 * Get all injury types for a body area
 */
export function getInjuryTypesForArea(area: keyof PositionStress): InjuryType[] {
  return INJURY_TYPES.filter((type) => type.avoidPositionStress.includes(area));
}

/**
 * Get display-friendly injury categories for UI
 */
export function getInjuryCategories(): { label: string; injuries: InjuryType[] }[] {
  return [
    {
      label: 'Back Injuries',
      injuries: INJURY_TYPES.filter((i) =>
        ['lower_back_strain', 'herniated_disc', 'sciatica', 'upper_back_strain'].includes(i.id)
      ),
    },
    {
      label: 'Shoulder Injuries',
      injuries: INJURY_TYPES.filter((i) =>
        ['shoulder_impingement', 'rotator_cuff_strain', 'shoulder_instability'].includes(i.id)
      ),
    },
    {
      label: 'Knee Injuries',
      injuries: INJURY_TYPES.filter((i) =>
        ['knee_injury', 'patellofemoral', 'meniscus_tear', 'acl_injury'].includes(i.id)
      ),
    },
    {
      label: 'Arm Injuries',
      injuries: INJURY_TYPES.filter((i) =>
        ['elbow_tendinitis', 'wrist_strain', 'carpal_tunnel'].includes(i.id)
      ),
    },
    {
      label: 'Hip Injuries',
      injuries: INJURY_TYPES.filter((i) =>
        ['hip_flexor_strain', 'hip_impingement', 'hip_bursitis'].includes(i.id)
      ),
    },
    {
      label: 'Neck Injuries',
      injuries: INJURY_TYPES.filter((i) => ['neck_strain', 'cervical_disc'].includes(i.id)),
    },
    {
      label: 'Ankle Injuries',
      injuries: INJURY_TYPES.filter((i) => ['ankle_sprain'].includes(i.id)),
    },
  ];
}

/**
 * Merge custom restrictions from follow-up questions with base restrictions
 */
export function mergeInjuryRestrictions(
  injury: UserInjury,
  injuryType: InjuryType
): InjuryMovementRestrictions {
  return {
    ...injuryType.avoidMovements,
    ...injury.customRestrictions,
  };
}
