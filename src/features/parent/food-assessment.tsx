"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { assessFoodSupport, foodAssessmentSchema, type FoodAssessmentAnswers, type FoodAssessmentHandoff, type FoodRecommendation } from "@/lib/parent/food-assessment";
import styles from "./parent.module.css";

const copy = {
  en: {
    title: "Let's find food support that works for your family.", intro: "Answer a few short questions. You do not need to know any program names. Your choices stay in this tab. When you continue, CaseLink checks them for your signed-in account before you authorize a specific request.",
    immediate: "Need food today?", direct: "Find food now", directNote: "No account needed. A listing does not confirm food in stock or a reservation.",
    enough: "Do you have enough food for today and tomorrow?", yes: "Yes", no: "No", unknown: "I'm not sure", select: "Choose an answer",
    history: "Do you get help paying for groceries, sometimes called SNAP or food stamps, or have you received it before?", never: "No, and I have not applied", applied: "I applied and am waiting", receiving: "I receive it now, or received it before",
    issue: "What has happened with that help?", renewal: "I need to renew or received a renewal notice", stopped: "My benefits stopped or changed", card: "I have a card, access or other benefit problem", none: "No current problem",
    submit: "See my options", results: "Your proposed next steps", pending: "You already applied. Follow up on that application rather than starting another one.",
    new: "Consider a new SNAP application for help paying for groceries. The program decides eligibility.", renewalReason: "Work on the renewal for the benefit you already receive.", problem: "Clarify the existing benefit issue. A new application may not be the right next step.", immediateReason: "Explore groceries or meals now while any longer benefit work continues.",
    titles: { food_now: "Food for now", snap_new: "Apply for SNAP", snap_pending: "Check a pending application", snap_renewal: "Renew SNAP", snap_problem: "Help with SNAP benefits" },
    unknownResult: "Your benefit history is still unknown. You can use direct food help and read the program choices below without guessing or starting a new application.", empty: "No new benefit action is proposed from these answers. Direct food help and the program choices below remain available.",
    control: "Nothing has started. Each link opens that path's facts and exact permission. Other options remain proposed; choosing one does not start the others.", change: "Change my answers", english: "These guided questions are available in Spanish. The following account and application screens currently remain in English.",
  },
  es: {
    title: "Busquemos apoyo alimentario para su familia.", intro: "Responda unas preguntas breves. No necesita conocer los nombres de los programas. Sus respuestas permanecen en esta pestaña. Al continuar, CaseLink comprueba las opciones para su cuenta antes de que autorice una solicitud específica.",
    immediate: "¿Necesita comida hoy?", direct: "Buscar comida ahora", directNote: "No necesita una cuenta. Un lugar en la lista no confirma que haya comida disponible ni una reserva.",
    enough: "¿Tiene suficiente comida para hoy y mañana?", yes: "Sí", no: "No", unknown: "No estoy seguro/a", select: "Elija una respuesta",
    history: "¿Recibe ayuda para comprar alimentos, a veces llamada SNAP o cupones de alimentos, o la recibió antes?", never: "No, y no he presentado una solicitud", applied: "Presenté una solicitud y estoy esperando", receiving: "La recibo ahora o la recibí antes",
    issue: "¿Qué ha ocurrido con esa ayuda?", renewal: "Necesito renovar o recibí un aviso de renovación", stopped: "Mis beneficios terminaron o cambiaron", card: "Tengo un problema con la tarjeta, el acceso u otro beneficio", none: "No tengo ningún problema actualmente",
    submit: "Ver mis opciones", results: "Sus próximos pasos propuestos", pending: "Ya presentó una solicitud. Dé seguimiento a esa solicitud en vez de iniciar otra.",
    new: "Considere solicitar SNAP para ayudar a pagar los alimentos. El programa determina la elegibilidad.", renewalReason: "Continúe con la renovación de los beneficios que ya recibe.", problem: "Aclare el problema con sus beneficios actuales. Una nueva solicitud puede no ser el paso adecuado.", immediateReason: "Busque alimentos o comidas ahora mientras continúa cualquier trámite de beneficios.",
    titles: { food_now: "Comida para ahora", snap_new: "Solicitar SNAP", snap_pending: "Consultar una solicitud pendiente", snap_renewal: "Renovar SNAP", snap_problem: "Ayuda con los beneficios de SNAP" },
    unknownResult: "Aún no sabemos si recibe beneficios. Puede buscar comida directamente y leer las opciones de programas sin adivinar ni iniciar una nueva solicitud.", empty: "Estas respuestas no indican que deba iniciar un nuevo trámite de beneficios. La ayuda alimentaria directa y las opciones de programas siguen disponibles.",
    control: "Nada ha comenzado. Cada enlace abre los datos y el permiso específico de esa opción. Las demás opciones siguen siendo propuestas; elegir una no inicia las otras.", change: "Cambiar mis respuestas", english: "Estas preguntas guiadas están disponibles en español. Las siguientes pantallas de cuenta y solicitud todavía están en inglés.",
  },
} as const;

export function FoodAssessment({ initial, onChoose }: { initial?: FoodAssessmentHandoff; onChoose?: (value: FoodAssessmentHandoff) => void }) {
  const [language, setLanguage] = useState<"en" | "es">(initial?.language ?? "en");
  const [languageChosen, setLanguageChosen] = useState(initial?.languageChosen ?? false);
  const [answers, setAnswers] = useState(initial?.answers ?? { foodForTwoDays: "", benefitHistory: "", existingIssue: null } as { foodForTwoDays: string; benefitHistory: string; existingIssue: string | null });
  const [paths, setPaths] = useState<FoodRecommendation[] | null>(initial ? assessFoodSupport(initial.answers) : null);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const firstAnswer = useRef<HTMLSelectElement>(null);
  const c = copy[language];
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = foodAssessmentSchema.safeParse(answers);
    if (!value.success) return;
    setPaths(assessFoodSupport(value.data));
    requestAnimationFrame(() => resultTitle.current?.focus());
  }
  const reason = (path: FoodRecommendation) => ({ immediate: c.immediateReason, new: c.new, pending: c.pending, renewal: c.renewalReason, problem: c.problem })[path.reason];
  return <section lang={language} aria-labelledby="food-assessment-title" className={styles.section}>
    <label className={styles.label} htmlFor="food-guide-language">Language / Idioma</label>
    <select id="food-guide-language" className={styles.select} value={language} onChange={event => { setLanguage(event.target.value as "en" | "es"); setLanguageChosen(true); }}><option value="en">English</option><option value="es">Español</option></select>
    <p className={styles.hint}>{language === "es" ? "Su selección también indica el idioma de servicio que prefiere para esta solicitud; no confirma la disponibilidad de un intérprete." : "Your selection also sets your preferred service language for this request; it does not confirm interpreter availability."}</p>
    <h1 id="food-assessment-title">{c.title}</h1><p>{c.intro}</p>
    <aside className={styles.notice} aria-label={c.immediate}><div><h2>{c.immediate}</h2><a className={styles.textLink} href="https://www.phila.gov/food/">{c.direct}</a><p>{c.directNote}</p></div></aside>
    {paths === null ? <form className={styles.form} onSubmit={submit}>
      <label className={styles.label} htmlFor="food-guide-enough">{c.enough}</label>
      <select className={styles.select} id="food-guide-enough" ref={firstAnswer} required value={answers.foodForTwoDays} onChange={event => setAnswers(current => ({ ...current, foodForTwoDays: event.target.value }))}>
        <option value="">{c.select}</option><option value="yes">{c.yes}</option><option value="no">{c.no}</option><option value="not_sure">{c.unknown}</option>
      </select>
      <label className={styles.label} htmlFor="food-guide-history">{c.history}</label>
      <select className={styles.select} id="food-guide-history" required value={answers.benefitHistory} onChange={event => setAnswers(current => ({ ...current, benefitHistory: event.target.value, existingIssue: null }))}>
        <option value="">{c.select}</option><option value="never">{c.never}</option><option value="applied">{c.applied}</option><option value="receiving">{c.receiving}</option><option value="not_sure">{c.unknown}</option>
      </select>
      {answers.benefitHistory === "receiving" && <><label className={styles.label} htmlFor="food-guide-issue">{c.issue}</label>
        <select className={styles.select} id="food-guide-issue" required value={answers.existingIssue ?? ""} onChange={event => setAnswers(current => ({ ...current, existingIssue: event.target.value as FoodAssessmentAnswers["existingIssue"] }))}>
          <option value="">{c.select}</option><option value="renewal">{c.renewal}</option><option value="stopped">{c.stopped}</option><option value="card">{c.card}</option><option value="none">{c.none}</option><option value="not_sure">{c.unknown}</option>
        </select></>}
      <button className={styles.button}>{c.submit}</button>
    </form> : <div aria-labelledby="food-guide-results">
      <h2 id="food-guide-results" tabIndex={-1} ref={resultTitle}>{c.results}</h2>
      {answers.benefitHistory === "not_sure" && <p>{c.unknownResult}</p>}
      {!paths.length && answers.benefitHistory !== "not_sure" && <p>{c.empty}</p>}
      {paths.map(path => <section key={path.need} className={styles.serviceOption}><div><h3>{c.titles[path.need as keyof typeof c.titles]}</h3><p>{reason(path)}</p>{onChoose ? <button type="button" className={styles.secondary} onClick={() => onChoose({ need: path.need, answers: foodAssessmentSchema.parse(answers), language, languageChosen })}>{c.titles[path.need as keyof typeof c.titles]}</button> : <Link className={styles.textLink} href={`/get-support?need=${path.need}`}>{c.titles[path.need as keyof typeof c.titles]}</Link>}</div></section>)}
      <p>{c.control}</p><button className={styles.secondary} onClick={() => { setPaths(null); requestAnimationFrame(() => firstAnswer.current?.focus()); }}>{c.change}</button>
    </div>}
    {language === "es" && <p className={styles.notice}>{c.english}</p>}
  </section>;
}
