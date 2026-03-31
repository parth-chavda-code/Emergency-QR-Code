import express from "express";
import { connectDB } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profile.js";

const app = express();
app.use(express.json());

try{
    await connectDB();
    app.listen(3000, ()=>{
        console.log("Listening on port 30000");
    });
} catch(err){
    console.log("error in app.js",err);
}


app.use("/user",authRouter);
app.use("/profile",profileRouter);