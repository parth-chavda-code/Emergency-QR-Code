import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectDB = async() => {
    try{
        await mongoose.connect(process.env.dbconnection);
        console.log(process.env.dbconnection);
        console.log("DB connection success");
    }catch(err){
        console.log("DB not connected Successfully",err);
        throw err;
    }
}

export {connectDB};