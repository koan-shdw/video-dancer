// Some CLI providers return a usage-limit notice as an ordinary assistant reply.
// Only recognise provider notices at the start of a line, not mentions in creative text.
export function codirProviderFailure(text: string): string | undefined {
  return text.split('\n').map(line => line.trim()).find(line =>
    /^(?:[⚠!]\s*)?(?:you(?:'ve| have) (?:hit|reached|exceeded) (?:your |the )?(?:weekly|monthly|daily|usage|rate|credit|spend|token) limit|(?:error[: ]+)?(?:insufficient_quota|rate_limit_exceeded|authentication_error)\b|(?:error[: ]+)?(?:insufficient|out of|not enough) (?:credits|balance)|(?:error[: ]+)?(?:quota|usage limit|rate limit|credit balance) (?:exceeded|reached|exhausted|is too low)|(?:error[: ]+)?(?:not logged in|please log in|invalid api key)\b)/i.test(line)
  )
}
