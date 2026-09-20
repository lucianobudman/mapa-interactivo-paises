const auth = firebase.auth();

function mostrarLogueado(email) {
  document.getElementById("auth-logged-out").classList.add("hidden");
  document.getElementById("auth-logged-in").classList.remove("hidden");
  document.getElementById("auth-user-email").textContent = email;
}

function mostrarDeslogueado() {
  document.getElementById("auth-logged-out").classList.remove("hidden");
  document.getElementById("auth-logged-in").classList.add("hidden");
}

function mostrarErrorAuth(mensaje) {
  const el = document.getElementById("auth-error");
  el.textContent = mensaje;
  el.classList.remove("hidden");
}

function limpiarErrorAuth() {
  const el = document.getElementById("auth-error");
  el.textContent = "";
  el.classList.add("hidden");
}

function traducirErrorFirebase(err) {
  const mensajes = {
    "auth/email-already-in-use": "Ese email ya está registrado. Iniciá sesión en vez de registrarte.",
    "auth/invalid-email": "El email no es válido.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe una cuenta con ese email. Registrate primero.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/missing-password": "Ingresá una contraseña.",
  };
  return mensajes[err.code] || `Ocurrió un error: ${err.message}`;
}

auth.onAuthStateChanged((user) => {
  window.usuarioLogueado = !!user;
  if (user) {
    mostrarLogueado(user.email);
  } else {
    mostrarDeslogueado();
  }
  window.dispatchEvent(new CustomEvent("authchange"));
});

document.getElementById("login-btn").addEventListener("click", async () => {
  limpiarErrorAuth();
  const email = document.getElementById("auth-email").value.trim();
  const pass = document.getElementById("auth-pass").value;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (err) {
    mostrarErrorAuth(traducirErrorFirebase(err));
  }
});

document.getElementById("register-btn").addEventListener("click", async () => {
  limpiarErrorAuth();
  const email = document.getElementById("auth-email").value.trim();
  const pass = document.getElementById("auth-pass").value;
  try {
    await auth.createUserWithEmailAndPassword(email, pass);
  } catch (err) {
    mostrarErrorAuth(traducirErrorFirebase(err));
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  auth.signOut();
});