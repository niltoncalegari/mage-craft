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
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type MatchLogDoc = InferSchemaType<typeof matchLogSchema> & { _id: Schema.Types.ObjectId };

export const MatchLog = model('MatchLog', matchLogSchema);
