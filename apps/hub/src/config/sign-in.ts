// What the person sees in the tab a plugin's provider sends them back to after signing in, and
// the name the hub registers under at the provider, which its sign-in page may show.
export const signInWording = (productName: string) => ({
  clientName: productName,
  title: `${productName} sign-in`,
  done: `You're signed in. Close this tab and go back to ${productName}.`,
  failed: `The sign-in did not finish. Close this tab and try again in ${productName}.`,
});
