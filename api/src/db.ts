import mongoose from 'mongoose';

/** Connects Mongoose to the given URI (defaults to config.mongoUri via caller). */
export async function connectDb(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
