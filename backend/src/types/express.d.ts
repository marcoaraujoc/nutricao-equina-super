import 'express';

declare global {
  namespace Express {
    interface Request {
      // Injetado por authenticate (auth.js)
      user?: {
        id: number;
        email: string;
        fullName: string;
        role: string;
        userType: string;
        mustChangePassword?: boolean;
      };

      // Injetado por checkPermission (permissao.middleware.js)
      permissaoNivel?: 'NENHUM' | 'LEITURA' | 'PROPRIO' | 'EQUIPE' | 'FULL';
      equipeId?: number;
      membroCargo?: string;
    }
  }
}

export {};