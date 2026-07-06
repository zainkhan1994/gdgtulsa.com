export const firebaseConfig = {
  apiKey: "AIzaSyCv7n7MkWctFbrv7IhVcR2nlSQKJ_Ivt2s",
  authDomain: "tulsahub.firebaseapp.com",
  projectId: "tulsahub",
  storageBucket: "tulsahub.firebasestorage.app",
  messagingSenderId: "254924280025",
  appId: "1:254924280025:web:b5b119f5ea4f62877beec8"
};

export const adminEmails = [
  "zain@gdgtulsa.com",
  "zainkhan1994.zk@gmail.com"
];

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);
