export async function resolve(specifier, context, nextResolve) {
  if (specifier === '/i18n.js') {
    return {
      url: new URL('./i18n-stub.js', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
