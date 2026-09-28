# Level 5 feedback and submission tracker

This document defines how ZEEP will onboard Preprod users, collect feedback, and record changes. It is also the evidence checklist for the Level 5 submission. Only count a participant after their wallet has interacted with the Preprod MVP and the interaction can be checked on-chain.

## Feedback loop

1. Invite a participant and explain that the MVP runs on Preprod, that tNIGHT transfers and wallet addresses are public, and that the deployed directory cannot prove address ownership on-chain.
2. Help them connect a Preprod wallet and complete one meaningful action, such as registering a handle or sending a small amount to a known handle.
3. Ask them to complete the questions below after the task. Do not ask for seed phrases, private keys, or wallet passwords.
4. Record a participant ID, their public Preprod wallet address, and an explorer link for the qualifying interaction. Only include the address in the submission after telling the participant it will be shared with reviewers.
5. Review feedback weekly. Group issues by onboarding, handle registration, sending, receiving/history, and documentation. Prioritize by severity and how many participants report the issue.
6. Record the decision, code or documentation change, and commit link in the change log. Tell affected participants what changed and ask them to retry when relevant.

## Participant questions

- What were you trying to do?
- Which step was unclear or failed?
- Did the handle resolve to the address you expected?
- Did the wallet confirmation show the recipient and amount you expected?
- Could you find the incoming or outgoing activity afterward?
- How confident are you that the payment went to the right person? (1–5)
- What is the one change that would make this easier?
- May ZEEP include your public Preprod wallet address in the Level 5 submission?

## Current evidence

- The live V3 directory currently contains two registered handles according to a read-only contract check. This is not a verified list of 50 distinct Level 5 participants.
- A 100 tNIGHT send from Zeep to Dori is confirmed in [Preprod transaction `2054f9…08223`](https://explorer.1am.xyz/tx/2054f9abb2cd7e122e3816a63491b9b6b6d9e6dc2dd9649a3af20b517fa08223?network=preprod). Recheck and record the sender and recipient addresses with participant consent before counting them in a public list.
- No structured participant feedback has been recorded in this repository yet. The questions and review process above are ready to use; actual responses and prioritization still need to be collected.

## Participant evidence log

Add one row per distinct wallet participant only after verifying the qualifying on-chain interaction and obtaining consent to share the address. Keep private notes and any contact details outside this public repository.

| # | Public Preprod wallet address | Qualifying explorer transaction or contract link | Feedback received | Consent to publish address |
| --- | --- | --- | --- | --- |

## Feedback decisions

| Date | Theme and evidence | Decision | Change or reason | Commit / follow-up |
| --- | --- | --- | --- | --- |

## Level 5 submission checklist

| Requirement | Current status | Evidence or remaining action |
| --- | --- | --- |
| Same MVP live on Preprod | Contract and two-wallet transfer verified; recipient Activity still needs a repeat check | [Contract](https://explorer.1am.xyz/contract/5bc1b71c7246a21c5502ff673493a6d6beb9e31c1b18b0508efb9dfe556a6538?network=preprod); [transfer](https://explorer.1am.xyz/tx/2054f9abb2cd7e122e3816a63491b9b6b6d9e6dc2dd9649a3af20b517fa08223?network=preprod) |
| Public repository and updated docs | Public repository exists; local documentation edits need to be committed and pushed | [GitHub repository](https://github.com/fezco22/zeep) |
| Live demo link | Deployed to Vercel production | [zeep-pink.vercel.app](https://zeep-pink.vercel.app/) |
| 50 Preprod users with verifiable wallet addresses | Not met; two registered handles observed | Collect and verify 50 distinct participating wallets; fill the evidence log |
| Feedback loop documented | Process and questions documented; no structured responses recorded yet | Collect feedback and fill the decision log |
| Demo video | Not recorded | Record registration, handle lookup, send, confirmation, and recipient receipt/history |
| At least 20 meaningful commits | 29 commits currently on `main` | Reviewers can inspect [commit history](https://github.com/fezco22/zeep/commits/main) |
| Product X profile linked in README | Not created or linked | Create the profile and replace the README TODO |

## Product behavior to disclose

The current MVP maps a public handle to an unshielded address and sends public native tNIGHT. The deployed V3 registration circuit does not authenticate ownership of the supplied address. The browser flow asks users to verify a mapping with its owner, but a direct contract call can register a forged mapping. Do not describe the current directory as trustless proof of ownership or the payment as private. See [registration security notes](REGISTRATION_AUTH.md).
