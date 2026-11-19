import { z } from "zod";
import { ANSWER_FIELDS, factValueSchema } from "./answers";
import type { ParentAssistantAnswer } from "./assistant-contract";
import { NEED_LABELS, OUTCOME_LABELS, intakeSchema } from "./domain";
import { parentText, type ParentLocale } from "./locale";
import { PROGRAMS } from "./programs";
import { SHARE_FOOD_ACCESS_SOURCE } from "./food-access";

export type AssistantDisplayPart = { text: string; language: ParentLocale | "" };
export type AssistantParagraphDisplay = { parts: AssistantDisplayPart[]; original?: AssistantDisplayPart; translated: boolean };
type Paragraph = ParentAssistantAnswer["paragraphs"][number];
const original = (text: string): AssistantDisplayPart => ({ text, language: "" });
const staticFacts: Record<string, Record<string, string>> = {
  "Your saved request": {
    "This support request is open. The recorded work status below explains whether a service is running or waiting.": "Esta solicitud de apoyo está abierta. El estado registrado del trabajo que aparece abajo explica si un servicio está en curso o en espera.",
    "You paused this support request. Application and follow-up work is stopped until you resume it. You can still ask questions about saved information.": "Puso en pausa esta solicitud de apoyo. El trabajo de la solicitud y el seguimiento están detenidos hasta que la reanude. Aún puede preguntar sobre la información guardada.",
    "You cancelled this support request. Future application and follow-up work is stopped. Asking a question does not restart it.": "Canceló esta solicitud de apoyo. El trabajo futuro de la solicitud y el seguimiento están detenidos. Hacer una pregunta no los reinicia.",
    "This support request is closed. Asking a question does not reopen it or start another application.": "Esta solicitud de apoyo está cerrada. Hacer una pregunta no la vuelve a abrir ni inicia otra solicitud.",
  },
  "How the assistant works": {
    "Questions here explain your saved support and verified program information. Chat does not submit an application, change your permission or supply a signature.": "Las preguntas aquí explican su apoyo guardado y la información verificada de los programas. La conversación no envía solicitudes, no cambia su autorización ni proporciona una firma.",
  },
  "CaseLink privacy controls": {
    "Do not send Social Security numbers, account numbers, passwords, EBT PINs or signatures in chat. If a program needs identity information, enter it directly through its official secure channel.": "No envíe números de Seguro Social, números de cuenta, contraseñas, PIN de EBT ni firmas en la conversación. Si un programa necesita datos de identidad, introdúzcalos directamente por su canal oficial seguro.",
  },
  "Your service permission": {
    "Your current permission covers research and preparation. It does not authorize CaseLink to send information, book appointments or submit applications.": "Su autorización actual permite investigar y preparar. No autoriza a CaseLink a enviar información, reservar citas ni presentar solicitudes.",
    "Your saved permission covers only its individually named programs, actions, data categories and limits. A program's permitted, connected delivery route is also required before execution.": "Su autorización guardada cubre únicamente los programas nombrados individualmente, las acciones, las categorías de datos y los límites indicados. Antes de actuar también se necesita una vía de entrega conectada y permitida por el programa.",
    "Your service permission has expired. Execution and follow-up work cannot continue without renewed permission; saved status questions remain available.": "Su autorización de servicio venció. El trabajo y el seguimiento no pueden continuar sin renovar la autorización; aún puede preguntar sobre el estado guardado.",
  },
  "Current service connection": {
    "The support worker is not currently reporting an active connection. Saved information is available, but CaseLink cannot promise that application preparation is running in the background.": "El servicio de apoyo no informa de una conexión activa en este momento. La información guardada está disponible, pero CaseLink no puede prometer que la preparación de la solicitud continúe en segundo plano.",
  },
  "Your account preferences": {
    "Your account preference is email and My support updates. Email delivery still requires a verified, connected channel.": "Su preferencia de cuenta es recibir actualizaciones por correo electrónico y en Mi apoyo. El envío de correo aún requiere un canal verificado y conectado.",
    "Your account preference is to receive updates only in My support.": "Su preferencia de cuenta es recibir actualizaciones solo en Mi apoyo.",
  },
};
const dated = (text: string) => z.iso.date().safeParse(text).success || z.iso.datetime({ offset: true }).safeParse(text).success;
const number = (text: string, minimum: number, maximum: number, integer = false) => String(Number(text)) === text && Number(text) >= minimum && Number(text) <= maximum && (!integer || Number.isInteger(Number(text)));
const fieldLabels: Record<string, string> = { zip: "código postal", householdSize: "tamaño del hogar", income: "ingresos", incomeAmount: "importe de ingresos", incomeFrequency: "frecuencia de ingresos", utilityProvider: "proveedor del servicio público", accountAuthority: "autoridad sobre la cuenta", amountDue: "importe adeudado", totalBalance: "saldo total", dueDate: "fecha de vencimiento", shutoffDate: "fecha de corte" };
const needLabels: Record<string, string> = { food_now: "Alimentos para ahora", snap_new: "Solicitar SNAP", snap_renewal: "Renovar SNAP", snap_pending: "Consultar una solicitud de SNAP", snap_problem: "Ayuda con los beneficios de SNAP", wic_new: "Solicitar WIC", wic_continuing: "Continuar el apoyo de WIC", electricity: "Factura de electricidad", gas: "Factura de gas", water: "Factura de agua" };
const needFromLabel = (text: string) => Object.entries(NEED_LABELS).find(([, label]) => label === text)?.[0] as keyof typeof NEED_LABELS | undefined;
const frequencyLabels: Record<string, string> = { weekly: "semanal", biweekly: "cada dos semanas", "twice monthly": "dos veces al mes", monthly: "mensual", yearly: "anual", unknown: "desconocida" };
const programCopy: Record<string, string> = {
  "Find city-listed food and meal locations. Confirm hours, pickup requirements and availability before traveling.": parentText("es", "Find city-listed food and meal locations. Confirm hours, pickup requirements and availability before traveling."),
  "Prepare public walk-up instructions for Share's community fridge at 2901 W Hunting Park Ave, 19129. Food depends on donations; stock is unknown and nothing is reserved.": parentText("es", "Prepare public walk-up instructions for Share's community fridge at 2901 W Hunting Park Ave, 19129. Food depends on donations; stock is unknown and nothing is reserved."),
  "Apply, renew or follow an existing SNAP application through Pennsylvania's official benefits service. A new application can begin without creating a COMPASS account. DHS determines eligibility.": parentText("es", "Apply, renew or follow an existing SNAP application through Pennsylvania's official benefits service. A new application can begin without creating a COMPASS account. DHS determines eligibility."),
  "Coordinate WIC enrollment, continuing support, documents and a specialist appointment.": "Coordine la inscripción en WIC, el apoyo continuo, los documentos y una cita con un especialista.",
  "Partner benefits navigation and help with a supported application or benefit problem.": "Orientación de una organización colaboradora sobre beneficios y ayuda con una solicitud o un problema de beneficios que admita.",
  "Philadelphia utility grant assistance. Funding, account requirements and any required contribution must be confirmed by the program.": "Ayuda con subsidios para servicios públicos en Filadelfia. El programa debe confirmar los fondos, los requisitos de la cuenta y cualquier contribución obligatoria.",
  "Explore PECO affordability and assistance options for an electric bill or threatened interruption.": "Explore las opciones de PECO para hacer asequible una factura de electricidad o recibir ayuda ante un posible corte.",
  "Explore PGW financial support, affordability and energy assistance options.": "Explore las opciones de PGW de apoyo financiero y ayuda para pagar los servicios de energía.",
  "Use the City's water assistance application route. The City does not accept application documents by email.": "Use la vía municipal para solicitar ayuda con el agua. El municipio no acepta documentos de la solicitud por correo electrónico.",
  "Confirm a practical pickup or delivery arrangement.": "Confirme un plan práctico de recogida o entrega.",
  "Collect food yourself or with a trusted helper if practical. Tell CaseLink if food was unavailable or another access method is needed.": "Recoja los alimentos usted o una persona de confianza, si es práctico. Avise a CaseLink si no había alimentos o si necesita otra forma de acceso.",
  "Complete any required provider verification, personal declaration or interview.": "Complete cualquier verificación, declaración personal o entrevista que exija el programa.",
  "Enter sensitive identifiers directly with DHS if required; do not share them in CaseLink chat.": "Introduzca los datos de identificación sensibles directamente con DHS si se requieren; no los comparta en la conversación de CaseLink.",
  "A WIC specialist completes the program's required assessment.": "Un especialista de WIC completa la evaluación que exige el programa.",
  "Provide route-required declarations or documents when requested.": "Proporcione las declaraciones o los documentos que exija la vía de acceso cuando se soliciten.",
  "A required household contribution or financial commitment needs your decision.": "Una contribución obligatoria del hogar o un compromiso financiero requiere su decisión.",
  "Authenticate directly with your provider if required.": "Autentíquese directamente con su proveedor si se requiere.",
  "Authenticate directly with PGW if required.": "Autentíquese directamente con PGW si se requiere.",
  "Personally accept any binding payment arrangement.": "Acepte personalmente cualquier acuerdo de pago vinculante.",
  "Complete any required account-holder declaration through an accepted City channel.": "Complete cualquier declaración obligatoria de la persona titular de la cuenta por un canal aceptado por el municipio.",
};
const operationCopy: Record<string, [string, string]> = {
  "Delivery was recorded. This does not establish agency submission or approval.": ["receipt", "Se registró la entrega. Esto no demuestra la presentación ante una agencia ni la aprobación."],
  "The partner's receipt was recorded. Agency submission and approval are separate steps.": ["receipt", "Se registró la recepción por la organización colaboradora. La presentación ante una agencia y la aprobación son pasos separados."],
  "The partner accepted the request. This does not establish agency submission or benefit approval.": ["receipt", "La organización colaboradora aceptó la solicitud. Esto no demuestra la presentación ante una agencia ni la aprobación de beneficios."],
  "An agency submission was recorded. The agency has not necessarily approved assistance.": ["receipt", "Se registró la presentación ante una agencia. La agencia no necesariamente ha aprobado la ayuda."],
  "Assistance approval was recorded. Support actually received is a separate outcome.": ["receipt", "Se registró la aprobación de la ayuda. El apoyo recibido realmente es un resultado separado."],
  "Support received was recorded.": ["receipt", "Se registró el apoyo recibido."],
  "A declined result was recorded.": ["receipt", "Se registró un resultado de denegación."],
  "an attempted delivery has an uncertain result. CaseLink must reconcile that exact attempt before retrying; a timeout is not proof of delivery or non-delivery.": ["Recorded delivery uncertainty", "el resultado de un intento de entrega es incierto. CaseLink debe conciliar ese mismo intento antes de reintentar; un tiempo de espera agotado no demuestra que se entregara ni que no se entregara."],
  "a packet was prepared. A prepared packet is not a submitted application.": ["Saved preparation record", "se preparó un paquete. Un paquete preparado no es una solicitud presentada."],
  "the saved outcome remains unresolved. No approval or support received is established by this status.": ["Saved unresolved status", "el resultado guardado sigue sin resolverse. Este estado no demuestra aprobación ni apoyo recibido."],
};
const receiptSources = ["provider api", "authenticated partner", "agency receipt", "operator confirmed"];
const sourceLabels = new Set([...Object.keys(staticFacts), "Your intake", "Current recorded work status", "Saved follow-up schedule", "Your saved answer", "Official program information", "Official program guidance", "Recorded delivery uncertainty", "Saved preparation record", "Saved unresolved status", "Parent-reported outcome", "Saved document status", "Your current necessary step", "Recorded City directory check, unconfirmed", ...receiptSources.map(source => `Recorded ${source} evidence`)]);
const introductions = new Set([
  "Here is the latest recorded information for your request.",
  "Here is what needs to happen next, based on your saved request.",
  "Here is the verified program information connected to your needs.",
  "Here is what CaseLink can currently do for this request.",
  "I do not have verified information to answer that fully. These saved details and official sources may help.",
]);
export function assistantIntroDisplay(text: string, locale: ParentLocale): AssistantDisplayPart {
  return introductions.has(text) ? { text: parentText(locale, text), language: locale } : original(text);
}
export function assistantSourceDisplay(text: string, locale: ParentLocale): AssistantDisplayPart {
  return sourceLabels.has(text) ? { text: parentText(locale, text), language: locale } : original(text);
}

/** Match only whole deterministic templates and their original source labels, never arbitrary family words. */
export function assistantParagraphDisplay(paragraph: Paragraph, locale: ParentLocale): AssistantParagraphDisplay {
  const fallback = { parts: [original(paragraph.text)], translated: false };
  if (locale === "en") {
    const recognized = assistantParagraphDisplay(paragraph, "es");
    return { parts: [{ text: paragraph.text, language: recognized.translated && paragraph.sourceLabel !== "Your current necessary step" ? "en" : "" }], translated: false };
  }
  const text = paragraph.text, source = paragraph.sourceLabel;
  const match = (expression: RegExp) => { const result = expression.exec(text); return result?.[0] === text ? result : null; };
  const translated = (template: string, values: Record<string, AssistantDisplayPart> = {}, keepOriginal = false): AssistantParagraphDisplay => ({
    parts: template.split(/(\{[a-z]+\})/g).filter(Boolean).map(part => part.startsWith("{") ? values[part.slice(1, -1)] : { text: part, language: "es" }).filter((part): part is AssistantDisplayPart => !!part),
    ...(keepOriginal ? { original: original(text) } : {}), translated: true,
  });
  if (Object.hasOwn(staticFacts, source) && Object.hasOwn(staticFacts[source], text)) return translated(staticFacts[source][text]);
  if (source === "Recorded City directory check, unconfirmed" && paragraph.sourceUrl === SHARE_FOOD_ACCESS_SOURCE.cityUrl) {
    const m = match(/^CaseLink recorded a public City directory check for ZIP (191\d{2}) at (\S+)\. ([1-3]) unconfirmed entries are saved in the request\. Stock, eligibility and practical access are not confirmed; the food need remains open\.$/);
    if (m && z.iso.datetime({ offset: true }).safeParse(m[2]).success) return translated("CaseLink registró una consulta del directorio municipal para el código postal {zip}, con fecha de {date}. Resultados del directorio guardados sin confirmar: {count}. Las existencias, los requisitos y el acceso práctico no están confirmados. La necesidad de alimentos sigue abierta.", { zip: original(m[1]), date: original(m[2]), count: original(m[3]) });
    if (text === "CaseLink checked the public City directory and no other matching entries were returned. This does not establish that no food help exists; the food need remains open.")
      return translated("CaseLink consultó el directorio municipal y no aparecieron otros lugares que coincidieran. Esto no demuestra que no haya ayuda alimentaria. La necesidad de alimentos sigue abierta.");
    if (text === "CaseLink could not check the City directory. The food need remains open and this is a service issue.")
      return translated("CaseLink no pudo consultar el directorio municipal. La necesidad de alimentos sigue abierta; el servicio debe resolver este problema.");
  }
  if (source === "Your account preferences") {
    let m = match(/^Your saved account service language is (Spanish|English)\.$/);
    if (m) return translated(`El idioma de servicio guardado en su cuenta es ${m[1] === "Spanish" ? "español" : "inglés"}.`, {}, true);
    m = match(/^Your saved quiet hours for routine updates are from (\d+):00 to (\d+):00\. Urgent service guidance remains available in My support\.$/);
    if (m && number(m[1], 0, 23, true) && number(m[2], 0, 23, true)) return translated("El horario de silencio guardado para las actualizaciones rutinarias es de {start}:00 a {end}:00. La orientación urgente del servicio sigue disponible en Mi apoyo.", { start: original(m[1]), end: original(m[2]) });
  }
  if (source === "Your intake") {
    let m = match(/^Your saved household ZIP code is (\d{5})\.$/);
    if (m) return translated("El código postal guardado de su hogar es {value}.", { value: original(m[1]) });
    m = match(/^Your saved household size is (\d+)\.$/);
    if (m && number(m[1], 1, 30, true)) return translated("El tamaño guardado de su hogar es {value}.", { value: original(m[1]) });
    m = match(/^Your saved income is \$(\S+) \(([a-z ]+)\)\. This is information you provided, not an agency eligibility decision\.$/);
    if (m && number(m[1], 0, 1000000) && intakeSchema.shape.incomeFrequency.options.some(frequency => frequency.replaceAll("_", " ") === m![2]) && Object.hasOwn(frequencyLabels, m[2])) return translated(`Sus ingresos guardados son \${amount} (${frequencyLabels[m[2]]}). Esta es información que usted proporcionó, no una decisión de elegibilidad de una agencia.`, { amount: original(m[1]) }, true);
    m = match(/^Your selected needs are: (.+)\. Your recorded urgency is (today|soon|planning)\.$/);
    if (m) {
      const needs = m[1].split("; ").map(needFromLabel);
      if (needs.length > 0 && needs.every(need => need !== undefined) && new Set(needs).size === needs.length) return translated("Sus necesidades seleccionadas son: {needs}. La prioridad registrada es {urgency}.", { needs: { text: needs.map(need => needLabels[need!]).join("; "), language: "es" }, urgency: { text: ({ today: "hoy", soon: "pronto", planning: "planificación" })[m[2]]!, language: "es" } }, true);
    }
    m = match(/^Your current recorded utility providers are (.+)\.$/);
    if (m && (m[1] === "not provided" || m[1].split("; ").every(item => /^(Electric bill|Gas bill|Water bill): (peco|pgw|pwd|other|unknown)$/.test(item)))) return translated("Los proveedores de servicios públicos registrados actualmente son {value}.", { value: original(m[1]) });
  }
  if (source === "Saved follow-up schedule") {
    const m = match(/^The next recorded work check is scheduled for (\S+)\. A schedule is not proof that the check has run\.$/);
    if (m && z.iso.datetime({ offset: true }).safeParse(m[1]).success && new Date(m[1]).toISOString() === m[1]) return translated("La próxima revisión del trabajo está programada para {date}. La programación no demuestra que la revisión se haya realizado.", { date: original(m[1]) });
  }
  if (source === "Your saved answer") {
    const m = match(/^(.+) — your current ([a-z ]+) answer is (.+)\. This is information you supplied for this need, as of (\S+)\.$/);
    if (m) {
      const need = needFromLabel(m[1]), field = ANSWER_FIELDS.find(field => field.replace(/([A-Z])/g, " $1").toLowerCase() === m[2]);
      let value: unknown = m[3]; try { value = JSON.parse(m[3]); } catch { /* String enum/ZIP values stay exactly as recorded. */ }
      if (field === "zip") value = m[3];
      if (need && field && dated(m[4]) && factValueSchema.safeParse({ need, field, value }).success && (typeof value === "object" ? JSON.stringify(value) : String(value)) === m[3]) return translated("{need} — su respuesta actual sobre {field} es {value}. Esta es información que usted proporcionó para esta necesidad, con fecha de {date}.", { need: { text: needLabels[need], language: "es" }, field: { text: fieldLabels[field], language: "es" }, value: original(m[3]), date: original(m[4]) }, true);
    }
  }
  if (source === "Official program information" || source === "Official program guidance") {
    const program = PROGRAMS.find(program => program.sourceUrl === paragraph.sourceUrl && text.startsWith(`${program.name}: `));
    if (program) {
      const body = text.slice(program.name.length + 2);
      const prefix = source === "Official program information" ? program.description : `${program.personalSteps.join(" ")} Required personal authentication, signatures and declarations must be completed by the appropriate person.`;
      if (body.startsWith(prefix) && Object.hasOwn(programCopy, program.description)) {
        if (source === "Official program guidance" && body === prefix && program.personalSteps.every(step => Object.hasOwn(programCopy, step))) return { ...translated("{program}: {steps} La autenticación personal, las firmas y las declaraciones obligatorias deben ser completadas por la persona correspondiente.", { program: original(program.name), steps: { text: program.personalSteps.map(step => programCopy[step]).join(" "), language: "es" } }), original: { text, language: "en" } };
        if (source === "Official program information") {
          let rest = body.slice(prefix.length).trim(); const explanations: string[] = [], matched: string[] = [];
          const issues: Record<string, string> = {
            "Program eligibility, capacity and approval are determined by the program.": "El programa determina la elegibilidad, la capacidad y la aprobación.",
            "CaseLink currently coordinates support in Philadelphia. Use local official help while we expand coverage.": "CaseLink coordina actualmente el apoyo en Filadelfia. Use la ayuda oficial de su localidad mientras ampliamos la cobertura.",
            "This program's information needs a current source review before CaseLink can recommend the route.": "La información de este programa necesita una revisión actualizada de la fuente antes de que CaseLink pueda recomendar esta vía.",
            ...Object.fromEntries(program.needs.map(need => [`Coverage for new ${NEED_LABELS[need].toLowerCase()} work is not confirmed. Current routing details are checked before starting it.`, `No se ha confirmado la cobertura para comenzar trabajo nuevo de ${needLabels[need]}. Los datos actuales de acceso se revisan antes de comenzar.`])),
          };
          while (rest) { const issue = Object.keys(issues).find(issue => rest === issue || rest.startsWith(`${issue} `)); if (!issue) break; matched.push(issue); explanations.push(issues[issue]); rest = rest.slice(issue.length).trimStart(); }
          if (!rest && explanations.length && new Set(matched).size === matched.length && body === `${prefix} ${matched.join(" ")}`) return { ...translated("{program}: {description} {limits}", { program: original(program.name), description: { text: programCopy[program.description], language: "es" }, limits: { text: explanations.join(" "), language: "es" } }), original: { text, language: "en" } };
        }
      }
    }
  }
  for (const program of PROGRAMS) {
    if (paragraph.sourceUrl !== program.sourceUrl || !text.startsWith(`${program.name}: `)) continue;
    const description = text.slice(program.name.length + 2), copy = Object.hasOwn(operationCopy, description) ? operationCopy[description] : undefined;
    if (copy && (source === copy[0] || copy[0] === "receipt" && receiptSources.some(receipt => source === `Recorded ${receipt} evidence`))) return translated("{program}: {description}", { program: original(program.name), description: { text: copy[1], language: "es" } });
  }
  if (source === "Parent-reported outcome") {
    const suffix = ". This is your report; it is not independent agency confirmation.";
    for (const outcome of ["support_received", "assistance_approved", "declined", "unresolved"] as const) {
      const prefix = `You reported ${OUTCOME_LABELS[outcome].toLowerCase()} for `;
      const need = text.startsWith(prefix) && text.endsWith(suffix) ? needFromLabel(text.slice(prefix.length, -suffix.length)) : undefined;
      if (need) return translated("Usted informó {outcome} para {need}. Este es su informe; no es una confirmación independiente de la agencia.", { outcome: { text: parentText("es", OUTCOME_LABELS[outcome]), language: "es" }, need: { text: needLabels[need], language: "es" } }, true);
    }
  }
  if (source === "Your current necessary step") {
    const suffix = " Use the matching next-step control in this request; chat does not save an application answer.";
    if (text.endsWith(suffix) && text.length > suffix.length) return { parts: [original(text.slice(0, -suffix.length)), { text: " Use el control correspondiente al próximo paso de esta solicitud; la conversación no guarda una respuesta de la solicitud.", language: "es" }], translated: true };
  }
  if (source === "Saved document status") {
    const m = match(/^Your saved documents: (.+)\. Document extraction does not submit an application\. Raw documents and identifying details are not included in this chat's model context\.$/);
    if (m) {
      const statuses: Record<string, string> = { uploaded: "cargados", processing: "en procesamiento", validated: "validados", unreadable: "ilegibles", "raw deleted": "originales eliminados", "deletion pending": "con eliminación pendiente", deleted: "eliminados" };
      const documents = m[1].split("; ").map(item => /^(\d+) (.+)$/.exec(item));
      if (documents.every(item => item && number(item[1], 0, Number.MAX_SAFE_INTEGER, true) && Object.hasOwn(statuses, item[2]))) return translated("Sus documentos guardados: {documents}. La extracción de documentos no presenta una solicitud. Los documentos originales y los datos de identificación no se incluyen en el contexto del modelo de esta conversación.", { documents: { text: documents.map(item => `${item![1]} ${statuses[item![2]]}`).join("; "), language: "es" } }, true);
    }
  }
  return fallback;
}
