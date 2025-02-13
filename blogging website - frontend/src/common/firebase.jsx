// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, signInWithPopup } from "firebase/auth";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCmfzQk6KIMMBxcsIhqIsLraqkvoE0PsCs",
  authDomain: "react-blogging-website-4bece.firebaseapp.com",
  projectId: "react-blogging-website-4bece",
  storageBucket: "react-blogging-website-4bece.firebasestorage.app",
  messagingSenderId: "1014281751349",
  appId: "1:1014281751349:web:aef8616f35da40b0a3da7c"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

//google auth

const provider = new GoogleAuthProvider();

const auth = getAuth();

export const authWithGoogle = async () => {
    let user = null;
    await signInWithPopup(auth, provider)
    .then((result) => {
        user = result.user;
    })
    .catch((error) => {
        console.log(error);
    });

    return user;
}