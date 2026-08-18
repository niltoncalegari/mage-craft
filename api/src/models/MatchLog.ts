import { Schema, model, type InferSchemaType } from 'mongoose';

/** Per-element usage for a single match — see docs/accounts-ranking-dashboard.md §3. */
const elementUsageSchema = new Schema(
  {
    elementId: { type: String, required: true },
    casts: { type: Number, required: true, min: 0, default: 0 },
    hits: { type: Number, required: true, min: 0, default: 0 },
    kills: { type: Number, required: true, min: 0, default: 0 },
    damageDealt: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

/** Casts of one spell in a single match — the deck half of a loadout's record. */
/**
 * `cardId` stays the key, and `rosterId` is *added* beside it rather than
 * replacing it.
 *
 * Every match logged before v1.3 is keyed this way, and `getUserCardStats`
 * aggregates a player's whole history over it — renaming the field would not
 * migrate that history, it would hide it. `rosterId` is what the pivot made
 * askable: which of the four bodies spent this. Optional, because a spell cast
 * through the team-wide effect door has nobody to credit.
 */
const cardUsageSchema = new Schema(
  {
    cardId: { type: String, required: true },
    rosterId: { type: String, required: false },
    casts: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const matchLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['sp-vs-ai', 'pvp'], required: true },
    won: { type: Boolean, required: true },
    kills: { type: Number, required: true, min: 0, default: 0 },
    deaths: { type: Number, required: true, min: 0, default: 0 },
    score: { type: Number, required: true, min: 0, default: 0 },
    difficulty: { type: String, enum: ['easy', 'normal', 'hard'], required: true },
    timeSeconds: { type: Number, required: true, min: 0, default: 0 },
    livesSpent: { type: Number, required: true, min: 0, default: 0 },
    map: { type: String, required: true },
    elements: { type: [elementUsageSchema], required: true, default: [] },
    /*
     * The loadout this match was played with, and what it achieved. All
     * optional with defaults so documents written before the squad builder
     * existed stay valid — there is nothing to migrate.
     */
    squad: { type: [String], default: [] },
    cards: { type: [cardUsageSchema], default: [] },
    structuresDestroyed: { type: Number, min: 0, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type MatchLogDoc = InferSchemaType<typeof matchLogSchema> & { _id: Schema.Types.ObjectId };

export const MatchLog = model('MatchLog', matchLogSchema);
