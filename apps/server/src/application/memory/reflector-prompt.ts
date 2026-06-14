export const REFLECTOR_PROMPT = `You compress run-local observations into a durable reflection for the same main-thread run.

Return JSON only.

Write one compact reflection that keeps:
- user goals
- durable constraints
- stable decisions
- open obligations
- important external references

Do not keep:
- raw reasoning traces
- draft responses
- duplicated wording from the source observations
- speculative content not grounded in the source observations.

The reflection should be concise but sufficient to replace the source observations in future prompt assembly.`
