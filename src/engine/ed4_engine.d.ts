declare const ED4Engine: {
  ATTR_NAMES: Record<string, string>;
  ATTR_COST: Record<string, number>;
  CARRY_TABLE: number[];
  STEP_BASE: Record<number, { dice: number[]; mod: number; label: string }>;
  STEP_CYCLE: Array<{ dice: number[]; label: string }>;
  RACES: Record<string, any>;
  DISCIPLINES: Record<string, any>;
  SPELLS_DB: Array<any>;
  SPELL_ALIASES: Record<string, string>;
  WEAVING_KEYWORDS: string[];
  attrToStep(val: number): number;
  getStepDice(step: number): { dice: number[]; mod: number; label: string };
  rollExplodingDie(sides: number): { sum: number; first: number; text: string };
  rollStepTest(
    step: number,
    opts?: { karma?: boolean; karmaDie?: number; dn?: number | string | null; isAction?: boolean }
  ): {
    step: number;
    diceLabel: string;
    total: number;
    isRuleOfOne: boolean;
    isSuccess: boolean | null;
    extraSuccesses: number;
    trace: string;
  };
  getDisciplineBonuses(disciplineId: string, circle: number): any;
  parseItemBonuses(text: string): Record<string, number>;
  calcEquippedBonuses(gear?: any[], threadItems?: any[]): Record<string, number>;
  calcPlDerived(pl: any): any;
  getPlActionMod(pl: any): number;
  findSpellInDb(name: string): any | null;
  hasSpellEffectRoll(sp: any): boolean;
  getThreadWeavingStep(pl: any, derived?: any): { step: number; rank: number; talentName: string };
  getSpellcastingStep(pl: any, derived?: any): { step: number; rank: number };
  resolveDamage(params: {
    rawDamage: number;
    armor?: number;
    currentDamage?: number;
    uncon?: number;
    death?: number;
    woundThreshold?: number;
    isStun?: boolean;
  }): {
    net: number;
    nextDamage: number;
    causedWound: boolean;
    knockdownDn: number;
    isUnconscious: boolean;
    isDead: boolean;
  };
  resolveAvoidBlow(params: {
    avoidStep: number;
    attackRollTotal: number;
    karma?: boolean;
    karmaDie?: number;
  }): { avoided: boolean | null; strainCost: number; rollResult: any };
  resolveRiposte(params: {
    riposteStep: number;
    attackRollTotal: number;
    karma?: boolean;
    karmaDie?: number;
  }): { riposted: boolean | null; strainCost: number; rollResult: any };
  matchRaceId(raw: string): string | null;
  matchDisciplineId(raw: string): string | null;
  parseAttrKey(raw: string): string;
  parseExcelWorkbook(wb: any): any;
  parseTxtSheet(text: string): any;
  normalizeImportedCharacter(basePl: any, data: any): any;
};

export default ED4Engine;
