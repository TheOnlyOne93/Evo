// Somatic physiology, energy bookkeeping & affect.
// Energy is conserved. Every unit of stamina comes from food the organism actually ate,
// reserves it was born with (paid for by its parents), or the founders' starting stock.
(function (Evo) {
  'use strict';
  const { clamp01 } = Evo.util;

  const FAT_ENERGY_DENSITY = 1.5;  // One unit of fat stores 1.5 units of carbohydrate energy
  const GROWTH_PROTEIN = 20.0;     // Protein a juvenile must build into its body to reach adult size
  const METABOLIC_SCALE = 3.0;     // Scales every running cost: basal, muscle and spikes

  // What a body needs before it can breed. Libido only rises near these, and the UI explains
  // which one is missing, so all three read this one table.
  const BREEDING = {
    maxSickness: 4.0, maxCrowding: 0.28, minLibido: 0.25, minStamina: 40.0, minWater: 40.0,
    reserve: { FEMALE: 120.0, MALE: 95.0 },     // Total stored energy needed to afford offspring
    protein: { FEMALE: 20.0, MALE: 10.0 },      // Eggs and sperm are made of protein
    proteinShare: { FEMALE: 0.8, MALE: 0.5 }    // Share of that protein actually handed to the child
  };

  // Starting stock for the very first founders
  const FOUNDER_RESERVES = { stamina: 70.0, carbs: 45.0, starches: 20.0, fats: 25.0, water: 85.0, protein: 40.0, growth: 1.0 };
  // Migrants (and animals added by hand) arrive as ordinary adults, no richer than a home-grown one
  const ADULT_RESERVES = { stamina: 50.0, carbs: 30.0, starches: 10.0, fats: 15.0, water: 70.0, protein: 20.0, growth: 1.0 };

  class BodySimulator {
    constructor(traits, reserves = FOUNDER_RESERVES) {
      const r = reserves;
      this.stamina = Math.min(100.0, r.stamina || 0);
      this.carbs = Math.min(100.0, r.carbs || 0);
      this.starches = Math.min(100.0, r.starches || 0);
      this.fats = Math.min(100.0, r.fats || 0);
      this.water = Math.min(100.0, r.water || 0);
      this.protein = Math.min(100.0, r.protein || 0); // Building material: growth, eggs, muscle upkeep
      this.growth = r.growth !== undefined ? r.growth : 0.0; // 0 = newborn, 1 = full adult size
      this.sickness = 0.0;

      this.stomachDistension = 20.0;
      this.ghrelin = 0.3;
      this.leptin = 0.5;
      this.libido = 0.0;
      this.crowdStress = 0.0;
      this.osmoticPressure = 0.1;
      this.adenosineDebt = 0.0;
      this.dehydrationTicks = 0;
      this.exhaustionTicks = 0;

      // Mind and tissue
      this.boredom = 0.0;  // Builds when nothing is new; relieved by novelty
      this.novelty = 0.0;  // How unfamiliar the senses were last tick (computed by the brain)
      this.noveltyAvg = 0.05;
      this.injury = 0.0;   // Tissue damage; healing uses protein
      this.pain = 0.0;     // Acute pain from contact, fades quickly

      // Affect: phasic signals derived only from changes in total bodily need (see updateAffect)
      this.joy = 0.0;
      this.stress = 0.0;
      this.prevDrive = null;

      this.isDead = false;
      this.causeOfDeath = null;
      this.timesBred = 0;
      this.ageTicks = 0;
      this.applyTraits(traits);
      this.reproductionCooldown = traits.estrusCooldownTicks;
    }

    // Derive physiology from the genome's traits (also used when the genome is mutated in place)
    applyTraits(traits) {
      this.traits = traits;
      this.sex = traits.sex;
      this.baseMetabolicCost = traits.basalCost * Math.pow(traits.bodyMass, 0.75); // Kleiber's law: mass^3/4
      this.maturityTicks = Math.floor(traits.maturityAgeSeconds * 60);
      this.maxLifespanTicks = Math.floor(traits.maxLifespanSeconds * 60);
    }

    // Adulthood needs both age and a finished body, and building a body takes protein
    get isMature() {
      return this.ageTicks >= this.maturityTicks && this.growth >= 1.0;
    }

    // All stored energy, in carbohydrate units
    get totalEnergy() {
      return this.stamina + this.carbs + this.starches * 0.96 + this.fats * FAT_ENERGY_DENSITY;
    }

    get breedingReserve() { return BREEDING.reserve[this.sex]; }
    get breedingProtein() { return BREEDING.protein[this.sex]; }

    die(cause) {
      if (this.isDead) return;
      this.isDead = true;
      this.causeOfDeath = cause;
    }

    update(localNeighbors = 0, env = { waterLoss: 1.0 }) {
      if (this.isDead) return;
      const T = this.traits;
      this.ageTicks++;

      // 1. Senescence
      if (this.ageTicks >= this.maxLifespanTicks) { this.die('old age'); return; }

      // 2. Crowding stress from nearby conspecifics (a purely local interaction)
      const crowdTarget = Math.min(1.0, Math.max(0, (localNeighbors - 2) * 0.25) * T.crowdingSensitivity);
      this.crowdStress += (crowdTarget - this.crowdStress) * 0.02;

      // 3. Basal metabolism: scales with mass and age; acute stress (arousal) raises it
      const senescenceWear = 1.0 + (this.ageTicks / this.maxLifespanTicks) * 0.5;
      const juvenileDiscount = this.isMature ? 1.0 : 0.65;
      const arousal = 1.0 + 0.5 * this.stress;
      this.stamina = Math.max(0, this.stamina - this.baseMetabolicCost * METABOLIC_SCALE * senescenceWear * juvenileDiscount * arousal);

      // 4. Water loss & osmoregulation (drought raises evaporation)
      this.water = Math.max(0, this.water - T.waterDrainRate * env.waterLoss);
      this.osmoticPressure = clamp01((100.0 - this.water) / 70.0);
      if (this.water <= 0.5) {
        this.dehydrationTicks++;
        if (this.dehydrationTicks > T.dehydrationTolerance * 1800) { this.die('dehydration'); return; }
      } else {
        this.dehydrationTicks = Math.max(0, this.dehydrationTicks - 2);
      }

      // 5. Gastric emptying
      if (this.stomachDistension > 0.05) this.stomachDistension = Math.max(0, this.stomachDistension - 0.022);

      // 6. Starch digestion into sugars (4% lost; slowed by dehydration and by high blood sugar)
      if (this.starches > 0.01) {
        let hydrolysis = Math.min(this.starches, T.amylaseRate);
        if (this.water < 25.0) hydrolysis *= Math.max(0.35, this.water / 25.0);
        if (this.carbs > 85.0) hydrolysis *= 0.35;
        this.starches -= hydrolysis;
        this.carbs = Math.min(100.0, this.carbs + hydrolysis * 0.96);
      }

      // 7. Sugar combustion into usable stamina, at most 1:1 (toxins and dehydration waste some)
      if (this.carbs > 0.01 && this.stamina < 99.5) {
        const demand = this.stamina < 40.0 ? 1.8 : (this.stamina < 75.0 ? 1.3 : 1.0);
        const transfer = Math.min(this.carbs, T.combustionSpeed * demand);
        this.carbs -= transfer;
        const detoxEfficiency = Math.max(0.35, 1.0 - (this.sickness / 75.0));
        const hydrationEfficiency = this.water < 25.0 ? Math.max(0.35, this.water / 25.0) : 1.0;
        this.stamina = Math.min(100.0, this.stamina + transfer * detoxEfficiency * hydrationEfficiency);
      }

      // 8. Lipid cycle: lossy in both directions, so storing and burning fat can never create energy
      if (this.carbs > 75.0 && this.stamina > 90.0 && this.fats < 98.0) {
        const store = Math.min(this.carbs - 75.0, T.lipogenesisRate);
        this.carbs -= store;
        this.fats = Math.min(100.0, this.fats + store * 0.85 / FAT_ENERGY_DENSITY);
      }
      if (this.carbs < 25.0 && this.fats > 0.001) {
        const burn = Math.min(this.fats, 0.0028);
        this.fats -= burn;
        this.carbs = Math.min(100.0, this.carbs + burn * FAT_ENERGY_DENSITY * T.lipolysisEfficiency);
      }

      // 8b. Protein: tissue upkeep, juvenile growth, and a last-resort fuel
      this.protein = Math.max(0, this.protein - 0.0006); // Constant tissue turnover
      if (this.growth < 1.0 && this.protein > 2.0) {
        const build = Math.min(this.protein - 2.0, 0.012);
        this.protein -= build;
        this.growth = Math.min(1.0, this.growth + build / GROWTH_PROTEIN);
      }
      if (this.carbs < 2.0 && this.fats < 0.5 && this.protein > 0.5) {
        const burn = Math.min(this.protein, 0.003); // Gluconeogenesis: wasting muscle for fuel
        this.protein -= burn;
        this.carbs = Math.min(100.0, this.carbs + burn * 0.5);
      }

      // 8c. Boredom builds while nothing is new and falls when the senses meet something unfamiliar
      // (0.05 is roughly the novelty of ordinary exploring: less than that and boredom builds)
      this.noveltyAvg += (this.novelty - this.noveltyAvg) * 0.05;
      this.boredom = clamp01(this.boredom + T.boredomRate * (1.0 - this.noveltyAvg / 0.05));

      // 8d. Injury heals slowly, and repair is built from protein
      if (this.injury > 0 && this.protein > 1.0) {
        const heal = Math.min(this.injury, 0.0005);
        this.injury -= heal;
        this.protein -= heal * 12.0; // Repair costs protein, though less than building new tissue
      }
      if (this.injury >= 1.0) { this.die('injury'); return; }
      this.pain *= 0.7;

      // 9. Fatigue clears while energy is available
      if (this.stamina > 35.0) this.adenosineDebt = Math.max(0, this.adenosineDebt - 0.00045);

      // 10. Appetite & satiety hormones
      const glycogenDeficit = Math.max(0, (100.0 - (this.carbs * 0.65 + this.starches * 0.35)) / 85.0);
      const gutEmptyFactor = Math.max(0, (100.0 - this.stomachDistension) / 100.0);
      this.ghrelin = Math.min(1.0, (glycogenDeficit * 0.70 + gutEmptyFactor * 0.30) * T.ghrelinGain);
      this.leptin = Math.min(1.0, ((this.fats / 100.0) * 0.40 + (this.stomachDistension / 100.0) * 0.60) * T.leptinGain);

      // 11. Libido rises only with maturity, an energy surplus, health and calm
      if (this.isMature && this.totalEnergy > this.breedingReserve * 0.9 && this.protein > this.breedingProtein * 0.9 &&
          this.sickness < BREEDING.maxSickness && this.crowdStress < BREEDING.maxCrowding) {
        this.libido = Math.min(1.0, this.libido + 0.004);
      } else {
        this.libido = Math.max(0.0, this.libido - 0.015);
      }

      // 12. Liver detoxification
      if (this.sickness > 0) {
        this.sickness = Math.max(0, this.sickness - T.detoxRate * T.toxinResistance);
      }

      if (this.reproductionCooldown > 0) this.reproductionCooldown--;

      // 13. Energy collapse: no stamina and no sugar left to burn, sustained
      if (this.stamina < 0.5 && this.carbs < 0.5) {
        if (++this.exhaustionTicks > 240) { this.die('starvation'); return; }
      } else {
        this.exhaustionTicks = Math.max(0, this.exhaustionTicks - 2);
      }

      this.updateAffect();
    }

    // Joy and stress are the body's phasic read-out of its own homeostasis: joy when total need
    // falls (food, water, rest, mating), stress when it rises (poison, crowding, depletion).
    // Nothing is labeled good or bad by hand; it all comes from the physiology.
    updateAffect() {
      const drive = this.totalDrive;
      if (this.prevDrive === null) this.prevDrive = drive;
      const change = drive - this.prevDrive;
      this.prevDrive = drive;
      const AFFECT_GAIN = 3.0;
      this.joy = Math.min(1.0, this.joy * 0.8 + Math.max(0, -change) * AFFECT_GAIN);
      this.stress = Math.min(1.0, this.stress * 0.8 + Math.max(0, change) * AFFECT_GAIN);
      if (this.joy < 0.0005) this.joy = 0.0;
      if (this.stress < 0.0005) this.stress = 0.0;
    }

    // Whatever the item actually contains goes in; overeating past capacity is simply wasted
    ingest(n) {
      if (!n) return;
      this.carbs = Math.min(100.0, this.carbs + (n.carbs || 0));
      this.starches = Math.min(100.0, this.starches + (n.starches || 0));
      this.fats = Math.min(100.0, this.fats + (n.fats || 0));
      this.water = Math.min(100.0, this.water + (n.water || 0));
      this.protein = Math.min(100.0, this.protein + (n.protein || 0));
      this.sickness = Math.min(100.0, this.sickness + (n.toxin || 0));
      this.stomachDistension = Math.min(100.0, this.stomachDistension + (n.bulk || 0));
    }

    // Muscles can only deliver what stamina pays for. Returns the fraction of the effort achieved.
    exert(cost) {
      const need = cost * METABOLIC_SCALE * this.traits.bodyMass;
      this.adenosineDebt = Math.min(1.0, this.adenosineDebt + 0.00010);
      // Protein-starved or injured muscle is weak
      const muscleCondition = (this.protein < 5.0 ? 0.6 : 1.0) * (1.0 - 0.4 * this.injury);
      if (this.stamina >= need) { this.stamina -= need; return muscleCondition; }
      const fraction = need > 0 ? this.stamina / need : 1.0;
      this.stamina = 0;
      return fraction * muscleCondition;
    }

    deductSpikeCost() {
      const cost = this.traits.spikeEnergyCost * METABOLIC_SCALE;
      if (this.stamina >= cost) {
        this.stamina -= cost;
        return true;
      }
      return false;
    }

    // Why this body can't breed right now, or null if it can. The first unmet need wins.
    breedingBlocker() {
      if (this.isDead) return 'dead';
      if (!this.isMature) return 'immature';
      if (this.reproductionCooldown > 0) return 'cooldown';
      if (this.sickness > BREEDING.maxSickness) return 'sick';
      if (this.crowdStress > BREEDING.maxCrowding) return 'crowded';
      if (this.totalEnergy <= this.breedingReserve) return 'energy';
      if (this.protein <= this.breedingProtein) return 'protein';
      if (this.stamina <= BREEDING.minStamina) return 'stamina';
      if (this.water <= BREEDING.minWater) return 'water';
      if (this.libido < BREEDING.minLibido) return 'libido';
      return null;
    }

    canReproduce() {
      return this.breedingBlocker() === null;
    }

    // Parents pay a genetically set fraction of their actual reserves into the offspring. The child
    // receives what was paid (its own capacity permitting); starch arrives predigested as sugar.
    deductParentalDowry() {
      const r = this.traits.parentalDowryRatio;

      const stamina = this.stamina * r * 0.6;
      this.stamina -= stamina;
      const carbs = this.carbs * r;
      this.carbs -= carbs;
      const starch = this.starches * r;
      this.starches -= starch;
      const fats = this.fats * r;
      this.fats -= fats;
      const water = this.water * r * 0.6;
      this.water -= water;
      const protein = Math.min(this.protein, this.breedingProtein * BREEDING.proteinShare[this.sex]);
      this.protein -= protein;

      this.reproductionCooldown = this.traits.estrusCooldownTicks;
      this.libido = 0.0;
      this.timesBred++;

      return { stamina, carbs: carbs + starch * 0.96, fats, water, protein };
    }

    // Each drive tracks one job the body needs done
    get energyHungerDrive() { return this.ghrelin; }                               // Fuel: sugar, starch, fat
    get proteinHungerDrive() { return clamp01((60.0 - this.protein) / 60.0); }     // Building material
    get lipidDeficitDrive() { return clamp01((30.0 - this.fats) / 30.0); }         // Long-term reserve
    get thirstDrive() { return this.osmoticPressure; }
    get fatigueDrive() { return Math.min(1.0, this.adenosineDebt * 0.70 + (this.stamina < 30.0 ? 0.3 : 0)); }
    get toxinDrive() { return Math.min(1.0, this.sickness / 100.0); }
    get mateDrive() { return this.libido; }
    // Total interoceptive need: the same drives the hypothalamus senses, equally weighted
    get totalDrive() {
      return this.energyHungerDrive + this.proteinHungerDrive + this.thirstDrive + this.fatigueDrive +
             this.toxinDrive + this.mateDrive + this.crowdStress + this.boredom + this.injury;
    }
  }

  // Combine two parents' dowries into a newborn's starting reserves
  BodySimulator.childReserves = (a, b) => ({
    stamina: a.stamina + b.stamina, carbs: a.carbs + b.carbs, fats: a.fats + b.fats,
    water: a.water + b.water, protein: a.protein + b.protein, growth: 0.0
  });

  Object.assign(Evo, { BodySimulator, BREEDING, FOUNDER_RESERVES, ADULT_RESERVES });
})(globalThis.Evo);
