// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { fixtureIntake, fixtureMandate, fixtureNow, fixtureRequest } from '@/lib/parent/test-fixtures';
import { ParentLocaleProvider, useParentLocale } from './parent-locale';
import { PermissionEditor } from './permission-editor';
import { NecessaryAnswers } from './necessary-answers';
import { NecessaryAnswer, NecessaryAnswerFields } from './necessary-answer';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const current = () => fixtureRequest({ intake: fixtureIntake({ needs: ['snap_pending'], incomeAmount: null, incomeFrequency: 'unknown' }), mandate: fixtureMandate({ recipientIds: ['snap-pa'] }) });
const action = { id: 'income', need: 'snap_pending' as const, field: 'income', reason: 'missing_fact' as const, resolver: 'parent' as const, title: 'Household income', explanation: 'Enter a current fact you know. This does not sign a form or certify an agency declaration.' };
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });
function Switch() { const { chooseLocale } = useParentLocale(); return <button onClick={() => chooseLocale('en')}>English</button>; }

it('marks untranslated utility options without changing their exact saved values', () => {
  render(<ParentLocaleProvider initialLocale="es">{['accountAuthority', 'utilityProvider'].map(field => <NecessaryAnswerFields key={field} action={{ ...action, id: field, need: 'electricity', field }} draft={{ value: '', frequency: '' }} onChange={vi.fn()}/>)}</ParentLocaleProvider>);
  for (const [label, value] of [['I’m the utility account holder', 'self'], ['I have permission to act for the utility account holder', 'authorized_caregiver'], ['Another provider', 'other']]) {
    const option = screen.getByRole('option', { name: label });
    expect(option.getAttribute('lang')).toBe(''); expect(option.getAttribute('value')).toBe(value);
  }
});

it('keeps full current selected captions connected to native controls without saving or changing machine values', () => {
  const request = { ...current(), required_actions: [action] }, fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ParentLocaleProvider initialLocale="es"><Switch/><NecessaryAnswers request={request} onChange={vi.fn()}/><NecessaryAnswerFields action={{ ...action, id: 'booking-caption', field: 'bookingPreference' }} draft={{ value: 'weekday_morning', frequency: '' }} onChange={vi.fn()}/></ParentLocaleProvider>);
  const frequency = screen.getByLabelText('¿Con qué frecuencia recibe estos ingresos?');
  fireEvent.change(frequency, { target: { value: 'biweekly' } });
  expect(document.getElementById(frequency.getAttribute('aria-describedby')!)?.textContent).toBe('Cada dos semanas');
  const booking = screen.getByLabelText('Horario preferido para la cita');
  expect(document.getElementById(booking.getAttribute('aria-describedby')!)?.textContent).toBe('Mañanas de lunes a viernes');
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(document.getElementById(frequency.getAttribute('aria-describedby')!)?.textContent).toBe('Every two weeks');
  expect((frequency as HTMLSelectElement).value).toBe('biweekly'); expect((booking as HTMLSelectElement).value).toBe('weekday_morning'); expect(fetch).not.toHaveBeenCalled();
});

it('shows exact Spanish permission and preserves original version, bounded server deadline and data choice', async () => {
  const request = current(), onChange = vi.fn(), expiresAt = '2026-11-20T12:00:00Z';
  const fetch = vi.fn().mockResolvedValueOnce(response({ authorization: { expiresAt } })).mockResolvedValueOnce(response({ ok: true })); vi.stubGlobal('fetch', fetch);
  render(<ParentLocaleProvider initialLocale="es"><PermissionEditor request={request} onChange={onChange}/></ParentLocaleProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar o renovar el permiso' }));
  expect(screen.getByText(/La información ya entregada puede permanecer con su destinatario/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Documentos autorizados y datos extraídos'));
  fireEvent.click(screen.getByLabelText(/Autorizo estos programas, acciones e información por hasta 30 días/));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar el permiso actualizado' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: 'replace_mandate', version: request.version, mandate: { ...request.mandate, allowedData: request.mandate.allowedData.filter(x => x !== 'documents'), expiresAt, maxRecipients: 1 } });
  expect(screen.getByRole('status').textContent).toBe('Su permiso actualizado está guardado. El trabajo futuro usará estos límites.');
});

it('saves Spanish grouped income with zero, preserving its machine fields, scope and version', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(fixtureNow.getTime());
  const request = { ...current(), required_actions: [action] }, onChange = vi.fn();
  const fetch = vi.fn().mockResolvedValue(response({ request: { ...request, version: request.version + 1, required_actions: [] } })); vi.stubGlobal('fetch', fetch);
  render(<ParentLocaleProvider initialLocale="es"><Switch/><NecessaryAnswers request={request} onChange={onChange}/></ParentLocaleProvider>);
  fireEvent.change(screen.getByLabelText('Ingresos del hogar antes de impuestos ($)'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('¿Con qué frecuencia recibe estos ingresos?'), { target: { value: 'weekly' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar todas las respuestas y continuar' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'answer_facts', version: request.version, answers: [{ need: 'snap_pending', field: 'income', value: { amount: 0, frequency: 'weekly' } }] });
  expect(screen.getByRole('status').textContent).toBe('Todas sus respuestas están guardadas. El trabajo permitido puede continuar.');
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('status').textContent).toBe('All your answers are saved. Permitted work can continue.');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps a Spanish correction failure and unsaved income visible without claiming a saved answer', async () => {
  const request = current(), fetch = vi.fn().mockResolvedValue(response({ error: 'This request changed.' }, 409)); vi.stubGlobal('fetch', fetch);
  render(<ParentLocaleProvider initialLocale="es"><NecessaryAnswer request={request} action={action} onChange={vi.fn()} correction/></ParentLocaleProvider>);
  fireEvent.change(screen.getByLabelText('Ingresos del hogar'), { target: { value: '12' } });
  fireEvent.change(screen.getByLabelText('¿Con qué frecuencia recibe estos ingresos?'), { target: { value: 'monthly' } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar respuesta de la cuenta' }));
  await screen.findByRole('alert');
  expect((screen.getByLabelText('Ingresos del hogar') as HTMLInputElement).value).toBe('12');
  expect(screen.getByRole('button', { name: 'Revisar la pregunta más reciente' })).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

it.each([false, true])('explains an invalid income in the selected language without a write (grouped=%s)', grouped => {
  const request = { ...current(), required_actions: [action] }, fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ParentLocaleProvider initialLocale="es"><Switch/>{grouped ? <NecessaryAnswers request={request} onChange={vi.fn()}/> : <NecessaryAnswer request={request} action={action} onChange={vi.fn()}/>}</ParentLocaleProvider>);
  const amount = screen.getByLabelText('Ingresos del hogar antes de impuestos ($)');
  fireEvent.change(amount, { target: { value: '-1' } });
  fireEvent.change(screen.getByLabelText('¿Con qué frecuencia recibe estos ingresos?'), { target: { value: 'weekly' } });
  fireEvent.submit(amount.closest('form')!);
  expect(screen.getByRole('alert').textContent).toContain('Ingrese una cantidad de ingresos de 0 a 1000000 y elija con qué frecuencia los recibe.');
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('alert').textContent).toContain('Enter an income amount from 0 to 1000000 and choose how often it is received.');
  expect((amount as HTMLInputElement).value).toBe('-1'); expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ['zip', 'abcde', 'Ingrese un código postal de cinco dígitos.'],
  ['householdSize', '0', 'Ingrese una cantidad entera de personas de 1 a 30.'],
])('explains invalid %s before any grouped fact is sent', (field, value, message) => {
  const request = { ...current(), required_actions: [{ ...action, field, title: field }] }, fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<ParentLocaleProvider initialLocale="es"><NecessaryAnswers request={request} onChange={vi.fn()}/></ParentLocaleProvider>);
  const input = screen.getByLabelText('Su respuesta'); fireEvent.change(input, { target: { value } }); fireEvent.submit(input.closest('form')!);
  expect(screen.getByRole('alert').textContent).toContain(message); expect(document.activeElement).toBe(input); expect(fetch).not.toHaveBeenCalled();
});
