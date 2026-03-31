import mongoose from "mongoose";

const {Schema} = mongoose;

const user = new Schema({
    email: {type: String,unique: true,required: true},
    password: {type: String,required: true},
    firstName: {type: String,required: true},
    lastName: {type: String, required: true}
});


const userModel = mongoose.model("User",user);
export {userModel};