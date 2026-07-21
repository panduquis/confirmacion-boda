(() => {
  "use strict";

  const API_URL = window.RSVP_CONFIG.apiUrl;
  const state = {
    invitation: null,
    attending: null,
    requestSequence: 0
  };

  const byId = (id) => document.getElementById(id);

  document.addEventListener("DOMContentLoaded", () => {
    byId("searchButton").addEventListener("click", searchInvitation);
    byId("saveButton").addEventListener("click", saveConfirmation);
    byId("backButton").addEventListener("click", goBack);
    byId("restartButton").addEventListener("click", restart);

    byId("codeInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") searchInvitation();
    });

    byId("attendeeCount").addEventListener("change", () => {
      renderAttendeeFields(Number(byId("attendeeCount").value));
    });

    document.querySelectorAll('input[name="attending"]').forEach((radio) => {
      radio.addEventListener("change", () => setAttendanceChoice(radio.value === "yes"));
    });

    const params = new URLSearchParams(window.location.search);
    const initialCode = normalizeCode(params.get("codigo") || "");

    if (/^BODA-\d{2}$/.test(initialCode)) {
      byId("codeInput").value = initialCode;
      searchInvitation();
    }
  });

  async function searchInvitation() {
    const code = normalizeCode(byId("codeInput").value);
    hideMessage("lookupMessage");

    if (!/^BODA-\d{2}$/.test(code)) {
      showMessage("lookupMessage", "Escribe un código válido, por ejemplo BODA-01.");
      return;
    }

    setLoading(byId("searchButton"), true, "Consultando…");

    try {
      const result = await jsonp({ action: "lookup", code });
      if (!result || !result.ok) {
        throw new Error(result?.message || "No fue posible consultar la invitación.");
      }
      displayInvitation(result.invitation);
    } catch (error) {
      showMessage("lookupMessage", error?.message || "No fue posible conectar con el sistema.");
    } finally {
      setLoading(byId("searchButton"), false, "Consultar invitación");
    }
  }

  function displayInvitation(invitation) {
    state.invitation = invitation;
    state.attending = null;

    byId("displayName").textContent = invitation.displayName;
    const seats = Number(invitation.maxSeats);
    byId("seatMessage").textContent = seats === 1
      ? "Hemos reservado un lugar especialmente para ti."
      : `Hemos reservado ${seats} lugares especialmente para ustedes.`;

    configureAttendeeCount(seats);

    document.querySelectorAll('input[name="attending"]').forEach((radio) => {
      radio.checked = false;
      radio.closest(".choice").classList.remove("selected");
    });

    byId("phone").value = "";
    byId("email").value = "";
    byId("comments").value = "";
    byId("attendeeSection").classList.add("hidden");
    byId("attendeeFields").innerHTML = "";
    hideMessage("formMessage");

    const previous = invitation.previousResponse;
    if (previous) {
      state.attending = Boolean(previous.attending);
      const selectedRadio = document.querySelector(
        `input[name="attending"][value="${state.attending ? "yes" : "no"}"]`
      );

      if (selectedRadio) {
        selectedRadio.checked = true;
        selectedRadio.closest(".choice").classList.add("selected");
      }

      byId("phone").value = previous.phone || "";
      byId("email").value = previous.email || "";
      byId("comments").value = previous.comments || "";

      if (state.attending) {
        const count = Math.min(Math.max(previous.attendees?.length || 1, 1), seats);
        byId("attendeeCount").value = String(count);
        byId("attendeeSection").classList.remove("hidden");
        renderAttendeeFields(count, previous.attendees || []);
      }
    }

    byId("lookupCard").classList.add("hidden");
    byId("successCard").classList.add("hidden");
    byId("formCard").classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function configureAttendeeCount(maxSeats) {
    const select = byId("attendeeCount");
    select.innerHTML = "";

    for (let count = 1; count <= maxSeats; count += 1) {
      const option = document.createElement("option");
      option.value = String(count);
      option.textContent = count === 1 ? "1 persona" : `${count} personas`;
      select.appendChild(option);
    }
  }

  function setAttendanceChoice(isAttending) {
    state.attending = isAttending;

    document.querySelectorAll(".choice").forEach((choice) => {
      choice.classList.toggle("selected", Boolean(choice.querySelector("input:checked")));
    });

    if (isAttending) {
      byId("attendeeSection").classList.remove("hidden");
      if (!byId("attendeeFields").children.length) {
        byId("attendeeCount").value = "1";
        renderAttendeeFields(1);
      }
    } else {
      byId("attendeeSection").classList.add("hidden");
      byId("attendeeFields").innerHTML = "";
    }

    hideMessage("formMessage");
  }

  function renderAttendeeFields(count, existing = null) {
    const savedValues = collectCurrentAttendeeValues();
    const source = existing || savedValues;
    const container = byId("attendeeFields");
    container.innerHTML = "";

    for (let index = 0; index < count; index += 1) {
      const previous = source[index] || { name: "", classification: "" };
      const card = document.createElement("article");
      card.className = "attendee-card";

      const number = document.createElement("div");
      number.className = "attendee-number";
      number.textContent = String(index + 1);

      const nameLabel = document.createElement("label");
      nameLabel.innerHTML = `Nombre completo
        <input class="attendee-name" type="text" maxlength="120"
          autocomplete="name" placeholder="Nombre y apellidos"
          value="${escapeAttribute(previous.name || "")}">`;

      const classificationLabel = document.createElement("label");
      classificationLabel.className = "classification-field";
      classificationLabel.innerHTML = `Clasificación
        <select class="attendee-classification">
          <option value="">Seleccionar</option>
          <option value="Hombre">Hombre</option>
          <option value="Mujer">Mujer</option>
          <option value="Bebé">Bebé</option>
        </select>`;

      classificationLabel.querySelector("select").value = previous.classification || "";
      card.append(number, nameLabel, classificationLabel);
      container.appendChild(card);
    }
  }

  async function saveConfirmation() {
    hideMessage("formMessage");

    if (state.attending === null) {
      showMessage("formMessage", "Indica si podrán acompañarnos.");
      return;
    }

    const attendees = state.attending ? collectCurrentAttendeeValues() : [];
    if (state.attending) {
      const validation = validateAttendees(attendees);
      if (!validation.ok) {
        showMessage("formMessage", validation.message);
        return;
      }
    }

    const email = byId("email").value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMessage("formMessage", "Revisa el formato del correo electrónico.");
      return;
    }

    const payload = {
      code: state.invitation.code,
      attending: state.attending,
      attendees,
      phone: byId("phone").value.trim(),
      email,
      comments: byId("comments").value.trim()
    };

    setLoading(byId("saveButton"), true, "Guardando…");

    try {
      const result = await jsonp({
        action: "save",
        payload: base64UrlEncode(JSON.stringify(payload))
      });

      if (!result || !result.ok) {
        throw new Error(result?.message || "No fue posible guardar la confirmación.");
      }

      byId("successMessage").textContent = result.message;
      byId("formCard").classList.add("hidden");
      byId("successCard").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      showMessage("formMessage", error?.message || "No fue posible guardar la confirmación.");
    } finally {
      setLoading(byId("saveButton"), false, "Guardar confirmación");
    }
  }

  function validateAttendees(attendees) {
    if (!attendees.length) return { ok: false, message: "Selecciona cuántas personas asistirán." };

    const normalizedNames = new Set();
    for (let index = 0; index < attendees.length; index += 1) {
      const attendee = attendees[index];
      const position = index + 1;

      if (attendee.name.length < 3) {
        return { ok: false, message: `Escribe el nombre completo del asistente ${position}.` };
      }

      if (!["Hombre", "Mujer", "Bebé"].includes(attendee.classification)) {
        return { ok: false, message: `Selecciona la clasificación del asistente ${position}.` };
      }

      const normalized = normalizeName(attendee.name);
      if (normalizedNames.has(normalized)) {
        return { ok: false, message: "Hay un nombre repetido. Revisa los datos de los asistentes." };
      }
      normalizedNames.add(normalized);
    }

    if (attendees.length > state.invitation.maxSeats) {
      return { ok: false, message: `Esta invitación admite un máximo de ${state.invitation.maxSeats} personas.` };
    }

    return { ok: true };
  }

  function collectCurrentAttendeeValues() {
    return Array.from(document.querySelectorAll(".attendee-card")).map((card) => ({
      name: card.querySelector(".attendee-name").value.trim().replace(/\s+/g, " "),
      classification: card.querySelector(".attendee-classification").value
    }));
  }

  function goBack() {
    byId("formCard").classList.add("hidden");
    byId("lookupCard").classList.remove("hidden");
    byId("codeInput").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function restart() {
    state.invitation = null;
    state.attending = null;
    byId("codeInput").value = "";
    byId("successCard").classList.add("hidden");
    byId("lookupCard").classList.remove("hidden");
    byId("codeInput").focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function jsonp(params, timeout = 25000) {
    return new Promise((resolve, reject) => {
      const callbackName = `__wedding_${Date.now()}_${state.requestSequence++}`;
      const script = document.createElement("script");
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("La conexión tardó demasiado. Intenta nuevamente."));
      }, timeout);

      function cleanup() {
        window.clearTimeout(timer);
        script.remove();
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
      }

      window[callbackName] = (data) => { cleanup(); resolve(data); };

      const query = new URLSearchParams({
        ...params,
        callback: callbackName,
        timestamp: Date.now().toString()
      });

      script.src = `${API_URL}?${query.toString()}`;
      script.onerror = () => {
        cleanup();
        reject(new Error("No fue posible conectar con el sistema de confirmación."));
      };
      document.head.appendChild(script);
    });
  }

  function base64UrlEncode(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function normalizeCode(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function normalizeName(value) {
    return String(value || "")
      .trim().toLocaleLowerCase("es-MX").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  }

  function escapeAttribute(value) {
    return String(value || "")
      .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function showMessage(id, text) {
    const element = byId(id);
    element.textContent = text;
    element.classList.remove("hidden");
  }

  function hideMessage(id) {
    const element = byId(id);
    element.textContent = "";
    element.classList.add("hidden");
  }

  function setLoading(button, isLoading, text) {
    button.disabled = isLoading;
    button.textContent = text;
  }
})();
