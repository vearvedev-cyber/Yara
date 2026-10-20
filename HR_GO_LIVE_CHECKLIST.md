# HR Go-Live Checklist

What's left before the HR side is finished and ERP work starts.
Ticked = done and tested. Updated as work progresses.

**Status:** in progress

---

## 1. Code fixes

- [x] **F1 — Cross-workspace bug.** `bulk_set_employer_borne` must refuse to run without a selected workspace (today it can change payslips in every workspace).
- [x] **F5 — Absenteeism lowers taxable pay.** Absent days are deducted before NAPSA/PAYE/NHIMA, the same as unpaid leave (Income Tax Act s2: tax is on actual earnings). Gratuity is *not* reduced by absenteeism, only by unpaid leave.
- [x] **F6 — PAYE gross-up for employer-borne staff.** When the employer pays the employee's PAYE, that tax is itself taxable: work out a notional gross so PAYE is charged on pay + tax paid for them. Shown on the payslip and used in the PAYE return.
- [x] **Previous redundancy payments.** Record redundancy an employee received before (here or elsewhere) so the K2,000,000 lifetime tax-free limit isn't over-granted. *(Salary Management → Final Settlements → "Previous redundancy payments")*
- [x] Tests for all of the above; full backend test suite passes. *(71 tests)*
- [x] Frontend type-check and build pass.
- [x] Docs updated (fix backlog in `ERP_IMPLEMENTATION_PLAN.md` §13, payroll posting in the finance doc).

## 2. Save the work

- [x] Commit everything on a new branch (not `main`). *(branch `hr-leave-gratuity-settlements`)*

## 3. Try it (you)

On desktop **and** phone, with `npm run dev` + `python manage.py runserver`:

- [ ] Leave: create a request (working-days preview shows), approve it, check the balance and History panel.
- [ ] Settings → Leave, Holidays & Gratuity: load Zambian holidays, save the leave and gratuity policies.
- [ ] Contract Schedule: open a gratuity breakdown.
- [ ] Engagements & Terminations → Prepare final settlement → add a manual deduction → approve (as a different user) → download PDF → mark paid.
- [ ] Salary Management → Add Employee to Payroll: Save/Cancel buttons work.
- [ ] Phone: open any form, press back → the form closes and you stay on the page.
- [ ] Payroll for an employer-borne employee: payslip shows the grossed-up PAYE.

## 4. Before go-live (you)

- [ ] Notify ZRA in writing if any workspace runs employer-borne (free-of-tax) payroll.
- [ ] Record previous redundancy payments for any employee who has had one.
- [ ] Check the public holiday list against the gazette.

## 5. Deploy

- [ ] Back up the production database.
- [ ] `python manage.py migrate` (creates the new tables, loads public holidays, recounts annual leave in working days).
- [ ] Build and deploy the frontend.
- [ ] Smoke test in production: open Leave balances, one gratuity breakdown, Final Settlements list.

---

## Later (ERP, not needed for HR go-live)

- F2 — payroll periods per workspace (ERP Phase 0)
- F3 — payroll maths in Decimal (before payroll → GL posting)
- F4 — typed payslip deductions (before payroll → GL posting)
