import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DAILY_LOGIN_COOKIE_NAME,
  issueDailyLoginCookie,
  secondsUntilKualaLumpurMidnight,
  verifyDailyLoginCookie,
} from '../lib/daily-login'

const USER_ID = '11111111-1111-4111-8111-111111111111'

function withSecrets<T>(dailySecret: string | undefined, serviceRoleKey: string | undefined, run: () => T): T {
  const previousDailySecret = process.env.DAILY_LOGIN_SECRET
  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  try {
    if (dailySecret === undefined) delete process.env.DAILY_LOGIN_SECRET
    else process.env.DAILY_LOGIN_SECRET = dailySecret
    if (serviceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey
    return run()
  } finally {
    if (previousDailySecret === undefined) delete process.env.DAILY_LOGIN_SECRET
    else process.env.DAILY_LOGIN_SECRET = previousDailySecret
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey
  }
}

test('daily login cookie has a stable application-specific name', () => {
  assert.equal(DAILY_LOGIN_COOKIE_NAME, 'qixin_daily_login_v1')
})

test('daily login cookie remains valid during the same Kuala Lumpur day', () => {
  withSecrets('test-daily-secret', undefined, () => {
    const value = issueDailyLoginCookie(USER_ID, new Date('2026-10-07T16:00:00.000Z'))
    assert.equal(
      verifyDailyLoginCookie(value, USER_ID, new Date('2026-10-08T15:59:59.999Z')),
      true,
    )
  })
})

test('daily login cookie expires at the next Kuala Lumpur midnight', () => {
  withSecrets('test-daily-secret', undefined, () => {
    const value = issueDailyLoginCookie(USER_ID, new Date('2026-10-07T15:59:59.999Z'))
    assert.equal(
      verifyDailyLoginCookie(value, USER_ID, new Date('2026-10-07T16:00:00.000Z')),
      false,
    )
  })
})

test('daily login cookie rejects a tampered value', () => {
  withSecrets('test-daily-secret', undefined, () => {
    const now = new Date('2026-10-08T04:00:00.000Z')
    const value = issueDailyLoginCookie(USER_ID, now)
    const finalCharacter = value.at(-1)
    const tampered = `${value.slice(0, -1)}${finalCharacter === 'A' ? 'B' : 'A'}`
    assert.equal(verifyDailyLoginCookie(tampered, USER_ID, now), false)
  })
})

test('daily login cookie is bound to the signed user id', () => {
  withSecrets('test-daily-secret', undefined, () => {
    const now = new Date('2026-10-08T04:00:00.000Z')
    const value = issueDailyLoginCookie(USER_ID, now)
    assert.equal(
      verifyDailyLoginCookie(value, '22222222-2222-4222-8222-222222222222', now),
      false,
    )
  })
})

test('seconds until Kuala Lumpur midnight handles daytime and fractional seconds', () => {
  assert.equal(secondsUntilKualaLumpurMidnight(new Date('2026-10-08T04:00:00.000Z')), 43_200)
  assert.equal(secondsUntilKualaLumpurMidnight(new Date('2026-10-08T15:59:30.250Z')), 30)
  assert.equal(secondsUntilKualaLumpurMidnight(new Date('2026-10-08T16:00:00.000Z')), 86_400)
})

test('dedicated secret takes priority and service-role fallback is derived', () => {
  const now = new Date('2026-10-08T04:00:00.000Z')
  const dedicatedValue = withSecrets('dedicated-secret', 'service-role-key', () =>
    issueDailyLoginCookie(USER_ID, now),
  )
  const fallbackValue = withSecrets(undefined, 'service-role-key', () =>
    issueDailyLoginCookie(USER_ID, now),
  )

  assert.notEqual(dedicatedValue, fallbackValue)
  withSecrets(undefined, 'service-role-key', () => {
    assert.equal(verifyDailyLoginCookie(fallbackValue, USER_ID, now), true)
    assert.equal(verifyDailyLoginCookie(dedicatedValue, USER_ID, now), false)
  })
})
