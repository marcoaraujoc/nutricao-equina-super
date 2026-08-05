// src/pages/AlterarSenhaObrigatoria.tsx
// Bloqueio de primeiro acesso: conta criada com a senha padrão (`mustChangePassword`).
//
// O formulário vive em `FormularioNovaSenha`, compartilhado com `ResetPassword` (o link
// do e-mail) — as duas telas são a MESMA tela de senha; o que muda é só a credencial
// usada para gravar (aqui, a SESSÃO ativa; lá, o token do link).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import FormularioNovaSenha from '../components/FormularioNovaSenha';

export default function AlterarSenhaObrigatoria() {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro]         = useState('');
  const { refreshUser } = useAuth();
  const navigate = useNavigate();

  const handleSalvar = async (novaSenha: string) => {
    setErro('');
    try {
      setSalvando(true);
      await api.patch('/users/me/senha', { novaSenha, obrigatoria: true });
      await refreshUser();
      toast.success('Senha definida! Agora complete o seu cadastro pessoal.');
      localStorage.setItem('s2vet_ob', 'convite');
      navigate('/cadastro-pessoal');
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.mensagem ?? err.response?.data?.error ?? 'Não foi possível conectar ao servidor. Tente novamente.'
        : 'Não foi possível conectar ao servidor. Tente novamente.';
      setErro(msg);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <FormularioNovaSenha
      titulo="Defina uma nova senha"
      subtitulo="Necessário antes de continuar"
      descricao="Sua conta foi criada com uma senha temporária. Defina uma senha pessoal para acessar o S2Vet com segurança."
      textoBotao="Salvar senha e continuar"
      salvando={salvando}
      erro={erro}
      onSubmit={handleSalvar}
      onAlterar={() => setErro('')}
    />
  );
}
