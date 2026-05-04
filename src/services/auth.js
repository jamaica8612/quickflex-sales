export function bindAuthEvents(ctx) {
  const {
    el,
    state,
    connectDb,
    login,
    logout,
    sendPasswordReset,
    setAuthMode,
    signup,
    updatePassword,
  } = ctx;

  el.setupConnect.addEventListener("click", async () => {
    try {
      el.setupError.textContent = "";
      await connectDb(el.setupUrl.value, el.setupKey.value, true);
    } catch (error) {
      el.setupError.textContent = error.message;
    }
  });
  el.loginBtn.addEventListener("click", () => {
    if (state.authMode === "signup" || state.authMode === "reset") {
      setAuthMode("login");
      return;
    }
    login().catch((error) => { el.authError.textContent = error.message; });
  });
  [el.authEmail, el.authPassword].forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (state.authMode === "signup" || state.authMode === "reset") return;
    event.preventDefault();
    login().catch((error) => { el.authError.textContent = error.message; });
  }));
  el.signupBtn.addEventListener("click", () => {
    if (state.authMode === "reset") {
      updatePassword().catch((error) => { el.authError.textContent = error.message; });
      return;
    }
    if (state.authMode !== "signup") {
      setAuthMode("signup");
      return;
    }
    signup().catch((error) => { el.authError.textContent = error.message; });
  });
  el.forgotPasswordBtn.addEventListener("click", () => {
    sendPasswordReset().catch((error) => { el.authError.textContent = error.message; });
  });
  el.pendingLogout.addEventListener("click", logout);
  el.logoutBtn.addEventListener("click", logout);
}
