import express from "express";
import { connectDB } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profile.js";
import { eRouter } from "./routes/emergency.js";

const app = express();
app.use(express.json());

app.use("/user",authRouter);
app.use("/profile",profileRouter);
app.use("/emergency",eRouter);

try{
    await connectDB();
    app.listen(3000, ()=>{
        console.log("Listening on port 3000");
    });
} catch(err){
    console.log("error in app.js",err);
}
