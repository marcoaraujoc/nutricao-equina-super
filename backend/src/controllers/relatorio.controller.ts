import { Request, Response } from 'express';
import { RelatorioNutricionalService } from '../services/relatorioNutricional.service';

const relatorioService = new RelatorioNutricionalService();

export class RelatorioController {

  async relatorioPaty(req: Request, res: Response) {
    try {
      const { animalId } = req.params;                    // ou req.query
      const { peso, tipoExercicio } = req.query;

      const resultado = await relatorioService.gerarRelatorioPaty(
        Number(animalId),
        peso ? Number(peso) : undefined,
        tipoExercicio as string
      );

      return res.json({
        sucesso: true,
        animalId: Number(animalId),
        dados: resultado
      });

    } catch (error: any) {
      console.error('Erro no relatório Paty:', error);
      return res.status(500).json({
        sucesso: false,
        mensagem: error.message
      });
    }
  }
}