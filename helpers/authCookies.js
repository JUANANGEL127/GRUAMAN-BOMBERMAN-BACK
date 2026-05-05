function baseCookieOptions(authConfig, path, maxAgeSeconds, httpOnly = true) {
  return {
    httpOnly,
    secure: authConfig.cookies.secure,
    sameSite: authConfig.cookies.sameSite,
    path,
    maxAge: maxAgeSeconds * 1000
  };
}

export function writeAuthCookies(res, authConfig, sessionResult) {
  res.cookie(
    authConfig.cookies.accessName,
    sessionResult.accessToken,
    baseCookieOptions(
      authConfig,
      authConfig.cookies.accessPath,
      authConfig.jwt.accessTtlSeconds,
      true
    )
  );
  res.cookie(
    authConfig.cookies.refreshName,
    sessionResult.refreshToken,
    baseCookieOptions(
      authConfig,
      authConfig.cookies.refreshPath,
      authConfig.refresh.ttlSeconds,
      true
    )
  );
  res.cookie(
    authConfig.cookies.csrfName,
    sessionResult.csrfToken,
    baseCookieOptions(
      authConfig,
      authConfig.cookies.csrfPath,
      authConfig.refresh.ttlSeconds,
      false
    )
  );
}

export function clearAuthCookies(res, authConfig) {
  const clearOptions = {
    secure: authConfig.cookies.secure,
    sameSite: authConfig.cookies.sameSite
  };
  res.clearCookie(authConfig.cookies.accessName, {
    ...clearOptions,
    path: authConfig.cookies.accessPath
  });
  res.clearCookie(authConfig.cookies.refreshName, {
    ...clearOptions,
    path: authConfig.cookies.refreshPath
  });
  res.clearCookie(authConfig.cookies.csrfName, {
    ...clearOptions,
    path: authConfig.cookies.csrfPath
  });
}
