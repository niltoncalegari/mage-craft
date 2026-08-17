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

/** A named squad + deck + program the player can bring to a match. */
const loadoutProfileSchema = new Schema(
  {
    id: { type: String, required: true, maxlength: 32 },
    name: { type: String, required: true, maxlength: 24 },
    squad: { type: [String], default: [] },
    deck: { type: [String], default: [] },
    strategy: {
      version: { type: Number, required: true },
      name: { type: String, default: '', maxlength: 24 },
      rules: { type: [strategyRuleSchema], default: [] },
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
