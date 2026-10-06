---
name: write-intent
description: Turn an idea, ticket or incident into intent/<slug>/intent.md using the project's intent template (Stage 1 of the AI-Native SDLC Playbook). Use when the user wants to capture an idea, start a change, or write an intent before any spec or code.
---

1. **Understand the idea.** Let the originator describe it in their own words. If a ClickUp task is linked, read it first.
2. **Brainstorm until it is concrete.** Ask the questions an analyst would ask, a few at a time:
   - What can't be done today, and who is affected?
   - What does better look like? How will we know it worked?
   - What is out of scope? What must not change (production, approvals, data)?
   - Which packages, services or people does it touch?
   Read the code the idea touches so constraints and affected systems are real paths, not guesses.
3. **Write `intent/<slug>/intent.md`** using the template in `intent/README.md`, with every section filled in. Status is `draft`. Keep the originator's wording for the problem and outcome. Record anything unresolved under Open questions, together with who decides it.
4. **Hand it back for review.** The originator and product owner correct it. Do not commit it, and do not start `spec.md` or code, until they accept it.
