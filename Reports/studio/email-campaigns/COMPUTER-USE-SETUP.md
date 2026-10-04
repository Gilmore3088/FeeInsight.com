# Computer-use prompt: finish the Fee Insight email setup

Paste everything below the line into Claude with computer use (Claude in Chrome or the
desktop app). Fill in the two `<...>` values first.

---

You're finishing the Fee Insight email setup in two web dashboards: MailerLite and Vercel. Work in my browser, where I'm already signed in. Go slowly, confirm each screen before you click, and stop to ask me if anything looks different from what's described here.

**Values:**
- My test inbox: `<your email address>`
- Sender name: `James Gilmore · Fee Insight`
- Sender / reply-to address: `hello@bankfeeindex.com`

## Hard rules
- Fee Insight only. The MailerLite account must be the one signed in as **hello@bankfeeindex.com**. If you ever see "AI Banking Institute", "AiBI" or "aibankinginstitute.com" anywhere, stop immediately, change nothing, and tell me.
- Do **not** activate or enable any automation. Do **not** send any campaign to a list. Test emails go only to my test inbox.
- Do not delete anything: no groups, automations, emails, env vars or deployments.
- Never type, copy or reveal the value of `MAILERLITE_API_KEY` or any other secret. Only check that it exists.
- Don't edit any email body. The email content was uploaded from code, and editing it in the visual builder can break it.

## Part 1: MailerLite (https://dashboard.mailerlite.com)
1. **Check the account.** Open the account menu (top right) and confirm the login is hello@bankfeeindex.com. If it isn't, stop.
2. **Default sender.** Find the account's default sender settings (Account settings, or wherever "Default sender" lives). Set the sender name to `James Gilmore · Fee Insight` and the email to `hello@bankfeeindex.com`. Save. Under Domains, confirm the sending domain shows as authenticated (green). Note which domain it is.
3. **Company address.** In Account settings → Company information, check whether a postal address is filled in. Don't invent one. Just tell me what's there.
4. **Automations.** Go to Automations. There should be exactly three, all **inactive**:
   - Fee Insight — Welcome: Fee Literacy series (5 emails, trigger group "Fee Insight · Newsletter")
   - Fee Insight — Report requests: sample to own report (3 emails, trigger group "Fee Insight · Report requests")
   - Fee Insight — Explorers: institution + state watchers (3 emails, trigger group "Fee Insight · Watchers")

   For each automation, open every email step and check that:
   - the subject is filled in;
   - the sender name reads `James Gilmore · Fee Insight` (if it still says "FeeInsight. com", change only the sender name field, from = hello@bankfeeindex.com, reply-to = hello@bankfeeindex.com, and save);
   - the content preview shows a designed email with the "Fee Insight" masthead, not a blank or default template.

   If MailerLite has a separate **Preheader** field, leave it empty. The preheader is built into the HTML.
   If an automation shows as **Draft** or "incomplete" even though every email checks out, open its workflow editor and save it (Save / Done) without turning it on. It should then show as **Inactive**. If it still says Draft, tell me which step it flags.
5. **Exclusion.** Open the trigger of the **Welcome** automation. If there's an "exclude subscribers in group" option, exclude "Fee Insight · Report requests". Save. Don't change anything else on the trigger.
6. **Test send.** For each of the three automations, use "Send test" (or the test-email option) to send the test emails to my test inbox only.
7. **Report back** with a table: automation → email # → subject → sender name → content looks designed (yes/no) → test sent (yes/no). List anything that looked wrong.

## Part 2: Vercel (https://vercel.com)
1. Open the project that serves **feeinsight.com** (the repo is feeschedule-hub). Go to Settings → Environment Variables.
2. Confirm `MAILERLITE_API_KEY` exists for **Production**. Don't open or copy its value.
3. Add or update these for **Production and Preview**. If a variable already exists with a different value, tell me before you overwrite it.

   | Name | Value |
   |---|---|
   | `MAILERLITE_SYNC_ENABLED` | `true` |
   | `MAILERLITE_GROUP_ID` | `200322864366224433` |
   | `MAILERLITE_REPORT_GROUP_ID` | `200322865521755984` |
   | `MAILERLITE_WATCHER_GROUP_ID` | `200322866720277972` |
4. Don't redeploy. Tell me what you added and what was already there. I'll redeploy after the code branch is merged.

## Part 3: final summary
Give me one short report:
- the MailerLite checks from Part 1;
- the domain and company-address status;
- the Vercel variables you added or found;
- anything you didn't do and why.

Finish with "Nothing was activated or sent to a list."
