# New Moon to Full: Monthly Moonshots on Midnight

**Source:** [Rise In Program Page](https://www.risein.com/programs/new-moon-to-full-monthly-moonshots-on-midnight/tasks/content/u9jeXEnqcTxHd7ftX)

## Overview

Where builders stop watching tutorials and start shipping real privacy-first applications.

This isn't another course, bootcamp, or weekend hackathon. It's a hands-on builder journey designed to take participants from their first Compact smart contract to launching a real application on Midnight Mainnet.

Throughout six lunar phases, participants will:

- Build real privacy-first dApps with Compact
- Create production-ready applications
- Learn Midnight's privacy-first development model
- Gather real user feedback and onboard users
- Deploy their product to Midnight Mainnet
- Compete for an **$8,000 prize pool**
- Build a portfolio of production-ready Web3 applications

As a project evolves, builders progress through the lunar cycle — from the New Moon to the Supermoon — transforming an initial idea into a fully launched privacy-preserving product. The program is open to students, hackers, indie builders, and aspiring founders alike.

Tagline: *"Start in the dark. Ship in the light."*

---

## Program Structure & Track

The program follows one complete lunar cycle, moving from the New Moon to the Supermoon. Each phase builds on the previous one, helping developers progressively learn Midnight while creating a real product.

**Monthly Prize Pool: $8,000**

| Level | Phase | Focus |
|---|---|---|
| 1 | 🌑 New Moon | Setup & First Contract — toolchain, first Compact contract, deploy on Preview/Preprod, seed initial idea |
| 2 | 🌒 Waxing Crescent | Frontend Integration — wire the contract to a frontend UI, connect Lace on Preprod |
| 3 | 🌓 First Quarter | Production-Grade dApp — polished dApp, tests, CI/CD, pick a problem from the provided list |
| — | 🌓 Idea Submission (The Turn) | Submit an idea against the problem statement; commit once approved |
| 4 | 🌔 Waxing Gibbous | MVP Goes Live — MVP live on Preprod, docs, CI/CD, public product (X) profile |
| 5 | 🌕 Full Moon | Users & Feedback — same MVP, docs, a living feedback loop, 50 Preprod users |
| 6 | 🌝 Supermoon | Mainnet Launch — deploy to Mainnet, iterate on feedback, brand assets, onboard 20 real users |

---

## Program Mechanics: How It Works

Core principles that keep the program high-quality and focused:

- **Online & Global:** The program is 100% online. Anyone with an internet connection and a passion for Midnight can build, submit, and earn rewards.
- **Sequential Progression:** Participants can progress as fast as they can build, but to be rewarded for a higher level, they must have successfully met all requirements for every preceding level.
- **Monthly Evaluation & Rewards:** At the end of each month, the technical committee reviews progress. Participants are eligible for the prize pool of the *highest valid level* reached that month. Once a reward is received for a level, the participant must move to the next level to remain eligible for future prizes.
- **New & Evolving Projects:** Participants can join with a new idea or an existing project, but submissions must show significant evolution and meet the specific requirements of each level through new progress made during the program period.
- **Team Collaboration:** Teams are welcome, but prizes are awarded per project/submission, not per individual participant.
- **Mentor & Market Fit Checkpoint:** Before onboarding users, participants must receive mentor feedback on both technical soundness and market fit. Onboarding users without this review will not count toward Level 5 and 6 progression.
- **Pivoting:** The core philosophy is progression ("level up" one project), but if a pivot is needed for better market fit, a participant may transition to a new project the following month with mentor approval.

---

## Notes for Builders

**Privacy is woven in from Level 1.** In Compact, circuit inputs are private by default. `disclose()` does not make a value public — it tells the compiler the developer considers it safe to expose. Data only becomes public when it crosses into a public domain: ledger writes, returns from exported contracts, or contract-to-contract calls.

**Networks:** Builders work across Midnight's live environments — Preview and Preprod for building and validation, and Mainnet for production launch. Levels 1–5 target Preview/Preprod; Level 6 (the Supermoon) deploys to Mainnet.

---

## Level Details

### 🌑 Level 1 — New Moon Submission

*In the new moon, the sky holds the moon entirely in shadow — present, but unseen. That is where you begin. You stand up your toolchain, write your first contract in Compact, and deploy to Preview/Preprod. Nothing is public yet, and nothing needs to be.*

**Mission:** Toolchain set up, first Compact contract written and deployed on Preview/Preprod, plus an initial idea.

**Who Can Join:** Open to everyone. A good fit for those curious about building privacy-first applications on Midnight, with basic frontend or full-stack experience, who enjoy learning by building real, shipped things.

**What You Will Learn:**
- Installing the Midnight toolchain (Compact compiler, proof server, Node 22, Docker)
- Writing a Compact contract with public ledger state and a private witness
- Using `disclose()` deliberately to control what becomes public
- Compiling to ZK circuits and deploying to Preprod

**Requirements to Pass:**
- Toolchain installed and a contract that compiles via `compact compile`
- Passing test suite
- Generated `managed/` directory present (circuits + keys)
- Contract deployed to Preview or Preprod with a visible contract address
- An initial product idea (1 short paragraph) drafted in the README
- Minimum 5 meaningful commits

**Submission Checklist:**
- Public GitHub repository with a README.md
- Setup instructions (how to run locally)
- Screenshot: successful compile output (circuits listed)
- Screenshot: contract deployed with address shown
- README section explaining public state vs. private witness
- Initial product idea paragraph
- Minimum 5 meaningful commits

**Reward:** No prize — this is the entry level. Completing it unlocks the prize track from Level 2 onward.

---

### 🌒 Level 2 — Waxing Crescent Submission

*The first thread of light. You wire your contract to a real frontend and bring Lace onto Preprod. For the first time your work has a face the world can glimpse — a thin, deliberate crescent. Most of it still rests in shadow; you have simply chosen to reveal the edge.*

**Mission:** Contract wired to a frontend UI, with Lace connected on Preprod.

**Who Can Join:** Developers who have completed Level 1 or have equivalent experience, with a deployed Compact contract and readiness to learn the Midnight.js SDK and DApp connector.

**What You Will Learn:**
- Midnight.js SDK and the DApp connector API
- Connecting and disconnecting the Lace wallet
- Calling a circuit from the frontend and handling its result
- Managing local private state; deploying to Preprod

**Requirements to Pass:**
- Lace wallet connect / disconnect implemented
- Circuit called successfully from the frontend
- An observable privacy behavior (something proven without being shown)
- Contract deployed to Preprod with a verifiable address
- Minimum 8 meaningful commits

**Submission Checklist:**
- Public GitHub repository with README
- Live demo link (Vercel, Netlify, or similar)
- Deployed Preprod contract address (verifiable on-chain)
- Demo video: wallet connect + a successful circuit call
- README documenting the privacy claim
- Minimum 8 meaningful commits

**Reward:** Selected winners receive a prize based on submission quality; each winner receives **$10**.

---

### 🌓 Level 3 — First Quarter Submission

*Half light, half shadow — the truest picture of Midnight itself. Your dApp hardens into something production-grade: tests, CI/CD, a polished build. Exactly half the moon is lit, and exactly as much of your app is disclosed as you decide.*

**Mission:** A polished, production-grade dApp with tests and CI/CD, plus a chosen problem from the provided list.

**Who Can Join:** Developers who have completed Level 2, with a frontend dApp wired to a deployed contract, understanding of circuits, wallet connection, and private state.

**What You Will Learn:**
- Designing a dApp around selective disclosure
- Writing contract and application tests
- Setting up a CI/CD pipeline (compile + test on every push)
- Scoping a realistic product proposal

**Provided Idea List (choose one):**
- Private Voting — anonymous ballots with publicly verifiable tallies
- Age / Eligibility Gate — prove a threshold without revealing the underlying value
- Private Allowlist Access — prove membership without revealing identity
- Confidential Credentials — prove a credential is valid without disclosing it
- Sealed-Bid Auction — private bids, verifiable winner
- Private Payroll / Splits — distribute funds without exposing amounts
- Anonymous Feedback / Survey — verifiable participation, private responses

**Requirements to Pass:**
- Fully functional dApp that meaningfully uses Midnight's privacy model
- Minimum 3 tests passing
- CI/CD pipeline running (workflow file + passing runs)
- Approved idea submitted from the provided idea list
- Minimum 10 meaningful commits

**Submission Checklist:**
- Public GitHub repository with complete README
- Live demo link
- Screenshot: test output (3+ tests passing)
- CI/CD badge or workflow file with passing runs
- Demo video (1 minute) showing full functionality
- README "privacy model" section: what an observer can and cannot learn
- Product proposal (from the idea list) submitted for approval
- Minimum 10 meaningful commits

**Reward:** Selected winners receive a prize based on submission quality; each winner receives **$30**.

---

### 💭 Idea Submission (The Turn)

Between Level 3 and Level 4, participants submit a brief overview of the idea they plan to work on for Level 4. This step ensures the idea aligns with the Level 4–6 scope and expectations before building begins.

**Form fields:**
- Essay: "What is your idea?"
- Single select — Category: Confidential DeFi, Identity/credentials, Payments, Tokenized assets, Dev tooling, Consumer focus, Gaming, Other

Completing this task unlocks Levels 4–6.

---

### 🌔 Level 4 — Waxing Gibbous Submission *(locked until Idea Submission is completed)*

Focus per the Program Structure table: MVP live on Preprod, documentation, CI/CD, and a public product (X) profile. Full requirements are revealed after completing the Idea Submission prerequisite.

### 🌕 Level 5 — Full Moon Submission *(locked)*

Focus: continued development of the same MVP, documentation, a living feedback loop, and onboarding 50 Preprod users.

### 🌝 Level 6 — Supermoon Submission *(locked)*

Focus: deploy to Mainnet, iterate on feedback, prepare brand assets, and onboard 20 real users.

*(Detailed requirements and prize amounts for Levels 4–6 were not visible/unlocked at the time of this review — they become accessible after submitting the Idea Submission form.)*

---

## Graduation

- **Final Feedback Form** *(locked)*
- **New Moon to Full: Monthly Moonshots on Midnight Certificate** *(locked)*

These become available after completing the earlier levels.

---

## The Big Picture: Rewards & Growth Path

This program is more than a challenge — it's a professional developer's journey where participants are rewarded for building their own product on Midnight, backed by an **$8,000 monthly prize pool** designed to empower and reward the most dedicated and talented builders in the ecosystem.

Participants are rewarded for their growth as they master the Midnight network. At the end of each month, they're eligible to compete for the prize pool of the highest valid level achieved.

**Pro-Tip:** Completing Level 6 puts a builder in contention for the next steps in the Midnight ecosystem. Top builders may be enrolled in *Aliit* (Midnight's technical fellowship), invited to submit a *Request for Startup*, or referred to *Build Club* — an ongoing community of shipping Midnight builders.

---

## Judging Criteria

Submissions are evaluated by a technical committee using a holistic, comparative scoring system:

- **Core Technical Standards:** Strong functionality, strict adherence to level requirements, and comprehensive documentation.
- **Code Quality & Security:** Clean, well-structured, and efficient code. For higher levels, smart contract security and optimization are also key evaluation criteria.
- **Ecosystem Fit:** Whether the project solves a real problem or fills a gap in the ecosystem — projects with high utility are prioritized.
- **User Traction (Levels 5 & 6):** Technical completion is only half the battle; active user onboarding and real-world interaction with the application must be demonstrated.

---

## FAQ

**General Information**

*What is the goal of the program?*
To bridge the gap between learning and shipping — transforming the learning process into a real-world product development journey. Developers move from basic transactions to building production-ready applications, fostering a sustainable ecosystem of high-quality tools and dApps on Midnight.

*Is the program online?*
Yes, fully online — participants can join and submit from anywhere in the world.

**Program Mechanics & Participation**

*Can I participate with a different project every month?*
The core philosophy is progression — sticking with one project and "leveling it up" rather than starting from scratch. A pivot is allowed (with mentor approval) if the initial idea needs a change for better market fit.

*Can I join with a project I've already started?*
Submissions must show significant evolution and meet each level's specific requirements with new progress made during the program period.

*How often can I "Level Up"?*
As fast as you can build. At month-end, all progress is reviewed and rewarded at the highest level reached, provided every preceding level's criteria were met. If an intermediate level's requirements aren't met, the reward defaults to the last unbroken level.

*If I pass multiple levels in one month, do I get rewards for each?*
No — only the highest level reached that month is eligible for that level's prize distribution.

*I'm working with a friend — should we apply separately?*
Teams are allowed, but the prize for a level is awarded per project/submission, not per person.

*Can I compete for the prize at the same level across multiple months?*
No — once a level is completed and rewarded, the participant must move to the next level to remain eligible for future prizes.

**Prizes & Evaluation**

*How are prize recipients selected?*
Via a technical committee's holistic scoring system covering core technical standards, code quality & security, ecosystem fit, and (for Levels 5–6) user traction.

*How is the $8,000 prize pool allocated?*
It's performance-based. While every level has a reward, most of the pool is weighted toward the higher levels (4, 5, and 6) to reward complex milestones, production-ready code, and successful user onboarding.

*When will prizes be received?*
Distributions are processed monthly; after evaluation, winners are notified and rewards are sent to their wallet.

**Learning & Support**

*Will there be live sessions or Q&A?*
Yes — regular office hours, technical workshops, and live Q&A sessions (optional participation), announced via community channels.

---

## Communication

The main communication channel is **WhatsApp** — participants are directed to join the official WhatsApp group via a link on the program page.

---

## Submission Logistics

Each level submission requires:
- Connecting a GitHub account and selecting a repository
- Choosing a submission period (e.g., July Challenge — Active; August/September Challenges — Upcoming)
- Meeting all listed requirements and checklist items before submitting for review
