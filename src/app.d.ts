// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    interface Error {
      message: string;
      code?: string;
    }

    interface Locals {
      admin?: {
        id: string;
        email: string;
        name: string | null;
      };
      sessionToken?: string;
      csrfToken?: string;
    }

    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
