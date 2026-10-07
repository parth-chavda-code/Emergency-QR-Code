import mongoose from "mongoose";

mongoose.set("bufferCommands", false);

export async function connectDB(databaseUri) {
    await mongoose.connect(databaseUri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 10000,
        autoIndex: false,
    });
}

export async function disconnectDB() {
    await mongoose.disconnect();
}

// Never log a URI or driver error contents.
mongoose.connection.on("error", () => {
    console.error("Database connection error");
});
