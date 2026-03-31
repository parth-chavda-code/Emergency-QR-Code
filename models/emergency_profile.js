import mongoose from "mongoose";

const {Schema} = mongoose;

const emergencyProfile = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    bloodType: {type: String,required: true},
    allergies: [{
        type: String,
        required: true
    }],
    emergencyContact: [{
        phone: String,
        name: String,
        relation: String,
    }],
    medicalCondition: [String],
    medications: [String],
    qrcodeToken: { type: String, unique: true, required: true }

});

const eprofileModel = mongoose.model("EmergencyProfile",emergencyProfile);

export{
    eprofileModel
};