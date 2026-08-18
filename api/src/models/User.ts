import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One rule of a strategy program (GDD §7): if `when`, cast `card` at `at`.
 *
 * `when` is deliberately `Mixed`. A condition is a small recursive tree, and
 * modelling it here would put the game's rule vocabulary in a service that
 * cannot import `sim/` at all — `api/tsconfig.json` fixes `rootDir` to `src`,
 * and `sim/balance.ts` reaches outside it. So this service stores the program
 * and enforces *structural* limits only (see routes/loadout.ts); the game
 * server runs `validateStrategy` and remains the authority on what is legal,
 * exactly as it already does for decks and squads.
 */
const strategyRuleSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 32 },
    enabled: { type: Boolean, required: true },
    card: { type: String, required: true, maxlength: 32 },
    when: { type: Schema.Types.Mixed, required: true },
    at: { type: String, required: true, maxlength: 32 },
  },
  { _id: false },
);

/**
 * A named squad, and a posture for each mage in it, that the player can bring
 * to a match.
 *
 * `deck` and `strategy` are **optional, not removed**. Nothing writes them any
 * more — v1.3 retired the hand and the program it was played from — but every
 * document saved before the pivot still carries them, and making them required
 * would make those documents unreadable rather than merely out of date. They
 * are simply ignored on the way out; `routes/loadout.ts` no longer accepts them
 * on the way in.
 *
 * `stances` is a Map because its keys are roster ids, which this service is
 * deliberately unable to enumerate — it cannot import `sim/` at all (see
 * `strategyRuleSchema` above). Structural limits are enforced here; the game
 * server decides what is actually a mage and what is actually a posture.
 */
const loadoutProfileSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 32 },
    name: { type: String, required: true, maxlength: 24 },
    squad: { type: [String], default: [] },
    stances: { type: Map, of: String, default: () => new Map<string, string>() },
    deck: { type: [String], default: undefined },
    strategy: {
      type: {
        version: { type: Number },
        name: { type: String, maxlength: 24 },
        rules: { type: [strategyRuleSchema] },
      },
      default: undefined,
    },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    /** Elo/MMR, PvP only — see api/src/aggregations/elo.ts. */
    rating: { type: Number, required: true, default: 1200 },
    /*
     * What the player brings to a match, so it follows the account across
     * devices instead of living only in one browser's localStorage. Defaulted
     * empty rather than required: every account that existed before this stays
     * valid, and an empty list simply means "this device's local copy wins".
     */
    loadouts: { type: [loadoutProfileSchema], default: [] },
    activeLoadoutId: { type: String, default: null, maxlength: 32 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Schema.Types.ObjectId };

export const User = model('User', userSchema);
