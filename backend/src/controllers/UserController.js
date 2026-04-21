const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const UserController = {
  /**
   * GET /api/users/me
   * Busca os dados do usuário usando o e-mail do token JWT (WHERE email)
   */
  getMe: async (req, res) => {
    try {
      const { email } = req.user; // vem do middleware authenticate

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          userType: true,
          cep: true,
          endereco: true,
          complemento: true,
          bairro: true,
          cidade: true,
          estado: true,
          createdAt: true,
          ativo: true,
        },
      });

      if (!user) {
        return res.status(404).json({ success: false, error: 'Usuário não encontrado' });
      }

      return res.status(200).json(user);
    } catch (error) {
      console.error('Erro em getMe:', error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar usuário' });
    }
  },

  /**
   * PUT /api/users/me
   * Atualiza o cadastro pessoal usando o e-mail do token (WHERE email)
   */
  updateMe: async (req, res) => {
    try {
      const { email } = req.user;

      const {
        fullName,
        phone,
        cep,
        endereco,
        complemento,
        bairro,
        cidade,
        estado,
        userType
      } = req.body;

      const updatedUser = await prisma.user.update({
        where: { email },                    // ← WHERE por email (único na tabela)
        data: {
          fullName: fullName || undefined,
          phone: phone || undefined,
          cep: cep || undefined,
          endereco: endereco || undefined,
          complemento: complemento || undefined,
          bairro: bairro || undefined,
          cidade: cidade || undefined,
          estado: estado || undefined,
          userType: userType || undefined,
        },
      });

      console.log('✅ Cadastro Pessoal atualizado - Email:', email);

      return res.status(200).json({
        success: true,
        message: 'Cadastro pessoal salvo com sucesso!',
        user: updatedUser
      });

    } catch (error) {
      console.error('Erro ao atualizar cadastro pessoal:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro interno ao salvar cadastro pessoal'
      });
    }
  },
};

module.exports = UserController;