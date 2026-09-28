import { html, render, $, on } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { api } from '../lib/api.js';
import { getMasters } from '../lib/masters.js';
import { dataTable, pager } from '../lib/table.js';
import { emptyState, loadingBlock, toast, toastError, modal, field, options, showFieldErrors, clearErrors, setBusy, confirmDialog } from '../lib/ui.js';
import { debounce } from '../lib/dom.js';

const IDS = { employeeCode: 'e-code', salutation: 'e-sal', fullName: 'e-name', designation: 'e-desig', departmentId: 'e-dept', officialMobile: 'e-mobile', officialEmail: 'e-email', location: 'e-loc' };

export default async function employees(root) {
  const masters = await getMasters();
  const state = { q: '', departmentId: '', active: 'true', page: 1, pageSize: 25 };
  render(root, html`
    <div class="page-header"><div><h1>Employee / Host Directory</h1><div class="subtitle">Hosts selectable as “Host / Officer to be Met”. Designation and department appear automatically during registration.</div></div>
      <div class="page-actions"><button type="button" class="btn primary" data-add>${icon('plus')}Add Employee / Host</button></div></div>
    <section class="card">
      <div class="table-toolbar">
        <div class="row">
          <label for="e-q" class="sr-only">Search employees</label><input id="e-q" type="search" class="input" style="width:320px" placeholder="Search name, designation, department or Employee ID">
          <label for="e-fdept" class="sr-only">Department</label><select id="e-fdept" class="select" style="width:220px">${options(masters.departments, '', { placeholder: 'All departments' })}</select>
          <label for="e-factive" class="sr-only">Status</label><select id="e-factive" class="select" style="width:150px"><option value="true">Active</option><option value="false">Inactive</option><option value="all">All</option></select>
        </div>
        <span class="muted" data-count></span>
      </div>
      <div data-table>${loadingBlock('Loading employees…')}</div>
    </section>`);

  async function load() {
    try {
      const res = await api('/employees', { query: { q: state.q, departmentId: state.departmentId, active: state.active, page: state.page, pageSize: state.pageSize } });
      $('[data-count]', root).textContent = `${res.total} employees`;
      render($('[data-table]', root), html`${dataTable({
        caption: 'Employees and hosts',
        columns: [
          { key: 'code', label: 'Employee ID', render: (e) => html`<span class="code-ref">${e.employeeCode}</span>` },
          { key: 'name', label: 'Full Name', render: (e) => html`<div class="cell-main">${e.displayName}</div>${!e.isActive ? html`<span class="tag">Inactive</span>` : ''}` },
          { key: 'desig', label: 'Designation', render: (e) => e.designation },
          { key: 'dept', label: 'Department', render: (e) => e.departmentName },
          { key: 'contact', label: 'Official Contact', render: (e) => html`<div>${e.officialMobile || '—'}</div><div class="cell-sub">${e.officialEmail || ''}</div>` },
          { key: 'loc', label: 'Location', render: (e) => e.location || '—' },
          { key: 'visits', label: 'Visits', num: true, render: (e) => e.visitCount },
          { key: 'act', label: html`<span class="sr-only">Actions</span>`, render: (e) => html`<button type="button" class="btn sm" data-edit="${e.id}" aria-label="Edit ${e.displayName}">${icon('edit')}Edit</button>` },
        ],
        rows: res.items,
        empty: emptyState('No employees found', 'Try changing the search or add a new employee / host.', 'users'),
      })}${res.total > state.pageSize ? pager({ ...state, total: res.total, label: 'employees' }) : ''}`);
      state.items = res.items;
    } catch (err) { toastError(err); }
  }

  function editDialog(emp) {
    const m = modal({
      title: emp ? 'Edit Employee / Host' : 'Add Employee / Host',
      size: 'wide',
      body: html`<form data-ef novalidate><div class="grid cols-2">
        ${field({ id: 'e-code', label: 'Employee ID', required: true, control: html`<input id="e-code" name="employeeCode" class="input mono" maxlength="30" value="${emp?.employeeCode || ''}" aria-describedby="e-code-error">` })}
        <div class="grid" style="grid-template-columns:110px minmax(0,1fr)">
          ${field({ id: 'e-sal', label: 'Title', control: html`<select id="e-sal" name="salutation" class="select">${options(['', 'Mr.', 'Ms.', 'Mrs.', 'Dr.', 'Prof.', 'Shri', 'Smt.'], emp?.salutation || '')}</select>` })}
          ${field({ id: 'e-name', label: 'Full Name', required: true, control: html`<input id="e-name" name="fullName" class="input" maxlength="120" value="${emp?.fullName || ''}" aria-describedby="e-name-error">` })}
        </div>
        ${field({ id: 'e-desig', label: 'Designation', required: true, control: html`<input id="e-desig" name="designation" class="input" maxlength="100" value="${emp?.designation || ''}" aria-describedby="e-desig-error" placeholder="e.g. Manager – Administration">` })}
        ${field({ id: 'e-dept', label: 'Department', required: true, control: html`<select id="e-dept" name="departmentId" class="select" aria-describedby="e-dept-error">${options(masters.departments, emp?.departmentId, { placeholder: 'Select department' })}</select>` })}
        ${field({ id: 'e-mobile', label: 'Official Mobile', control: html`<input id="e-mobile" name="officialMobile" class="input mono" maxlength="16" value="${emp?.officialMobile || ''}" aria-describedby="e-mobile-error">` })}
        ${field({ id: 'e-email', label: 'Official Email', control: html`<input id="e-email" name="officialEmail" type="email" class="input" maxlength="254" value="${emp?.officialEmail || ''}" aria-describedby="e-email-error">` })}
        ${field({ id: 'e-loc', label: 'Location', control: html`<input id="e-loc" name="location" class="input" maxlength="100" value="${emp?.location || ''}" placeholder="e.g. First Floor, Block A">` })}
        <div class="field" style="justify-content:flex-end"><label class="checkbox" for="e-active"><input type="checkbox" id="e-active" name="isActive" ${!emp || emp.isActive ? 'checked' : ''}>Active (available as a host)</label></div>
      </div></form>`,
      footer: html`${emp ? html`<button type="button" class="btn danger-outline" data-remove style="margin-right:auto">${icon('trash')}Remove</button>` : ''}<button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn primary" data-save>Save</button>`,
    });
    const f = m.el.querySelector('[data-ef]');
    m.el.querySelector('[data-save]').addEventListener('click', async (e) => {
      clearErrors(f);
      const body = { employeeCode: f.employeeCode.value, salutation: f.salutation.value, fullName: f.fullName.value, designation: f.designation.value, departmentId: f.departmentId.value, officialMobile: f.officialMobile.value, officialEmail: f.officialEmail.value, location: f.location.value, isActive: f.isActive.checked };
      setBusy(e.currentTarget, true, 'Saving…');
      try {
        const r = await api(emp ? `/employees/${emp.id}` : '/employees', { method: emp ? 'PUT' : 'POST', body });
        toast(r.message); m.close(); load();
      } catch (err) {
        setBusy(e.currentTarget, false);
        if (err.fields) { const u = showFieldErrors(f, err.fields, IDS); if (u.length) toast(u[0], 'error'); } else toastError(err);
      }
    });
    m.el.querySelector('[data-remove]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Remove employee / host', message: `Remove ${emp.displayName} from the active directory? Historical visit records are kept.`, confirmLabel: 'Remove', danger: true }))) return;
      try { const r = await api(`/employees/${emp.id}`, { method: 'DELETE' }); toast(r.message); m.close(); load(); } catch (err) { toastError(err); }
    });
  }

  const reload = debounce(() => { state.page = 1; load(); }, 250);
  on(root, 'input', '#e-q', (e) => { state.q = e.target.value.trim(); reload(); });
  on(root, 'change', '#e-fdept', (e) => { state.departmentId = e.target.value; state.page = 1; load(); });
  on(root, 'change', '#e-factive', (e) => { state.active = e.target.value; state.page = 1; load(); });
  on(root, 'click', '[data-add]', () => editDialog(null));
  on(root, 'click', '[data-edit]', (e, b) => editDialog(state.items.find((x) => x.id === Number(b.dataset.edit))));
  on(root, 'click', '[data-page]', (e, b) => { state.page = Number(b.dataset.page); load(); });
  on(root, 'change', '[data-page-size]', (e) => { state.pageSize = Number(e.target.value); state.page = 1; load(); });
  await load();
  $('#e-q', root).focus();
}
