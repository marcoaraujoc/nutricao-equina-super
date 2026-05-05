CREATE TABLE IF NOT EXISTS `tb_ocorrencias_saude` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `dataInicio` DATETIME NOT NULL,
    `dataFim` DATETIME,
    `problema` TEXT NOT NULL,
    `tratamento` TEXT,
    `responsavel` TEXT,
    CONSTRAINT `tb_ocorrencias_saude_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS `tb_especies` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `nome` TEXT NOT NULL
);
INSERT INTO tb_especies VALUES(1,'Equino');
INSERT INTO tb_especies VALUES(2,'Cachorro');
INSERT INTO tb_especies VALUES(3,'Felino');
CREATE TABLE IF NOT EXISTS `tb_racas` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `especieId` INTEGER NOT NULL,
    CONSTRAINT `tb_racas_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO tb_racas VALUES(1,'Golden Retriver',2);
INSERT INTO tb_racas VALUES(2,'Brasileiro de Hipsimo',1);
CREATE TABLE IF NOT EXISTS `tb_animal_exercise` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `tipo` TEXT NOT NULL,
    `periodicidade` TEXT NOT NULL,
    CONSTRAINT `tb_animal_exercise_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO tb_animal_exercise VALUES(33,30,'Salto','1x na semana');
CREATE TABLE IF NOT EXISTS `tb_alimentos` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `categoria` TEXT NOT NULL,
    `fabricante` TEXT,
    `forma` TEXT,
    `ativo` BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO tb_alimentos VALUES(1,'Ração S-250','Concentrado','Royal Horse','Extrusada',1);
CREATE TABLE IF NOT EXISTS `tb_composicao_alimento` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `alimentoId` INTEGER NOT NULL,
    `nutrienteId` INTEGER NOT NULL,
    `valorPorKg` REAL NOT NULL,
    `base` TEXT NOT NULL DEFAULT 'Seca',
    CONSTRAINT `tb_composicao_alimento_alimentoId_fkey` FOREIGN KEY (`alimentoId`) REFERENCES `tb_alimentos` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tb_composicao_alimento_nutrienteId_fkey` FOREIGN KEY (`nutrienteId`) REFERENCES `tb_nutrientes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO tb_composicao_alimento VALUES(3,1,3,0.0700000000000000066,'Seca');
CREATE TABLE IF NOT EXISTS `tb_nutrientes` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `categoria` TEXT NOT NULL,
    `unidadePadrao` TEXT NOT NULL
);
INSERT INTO tb_nutrientes VALUES(3,'Extrato Étero','Vitamina','g');
CREATE TABLE IF NOT EXISTS `tb_animais` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `nome` TEXT NOT NULL,
    `peso` REAL NOT NULL,
    `dataNascimento` DATETIME,
    `sexo` TEXT NOT NULL,
    `photoUrl` TEXT,
    `dataCadastro` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `especieId` INTEGER NOT NULL,
    `racaId` INTEGER,
    `userId` INTEGER NOT NULL,
    CONSTRAINT `tb_animais_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `tb_animais_especieId_fkey` FOREIGN KEY (`especieId`) REFERENCES `tb_especies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tb_animais_racaId_fkey` FOREIGN KEY (`racaId`) REFERENCES `tb_racas` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO tb_animais VALUES(30,'MAIS UM TESTE',70.0,946684800000,'Macho','/uploads/1777510014669-729574701.png',1777510015230,1,1,2,12);
CREATE TABLE IF NOT EXISTS `tb_audit_logs` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `userName` TEXT NOT NULL,
    `email` TEXT NOT NULL,
    `action` TEXT NOT NULL,
    `timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT `tb_audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO tb_audit_logs VALUES(34,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1776985737352);
INSERT INTO tb_audit_logs VALUES(35,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777026238737);
INSERT INTO tb_audit_logs VALUES(36,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777327382375);
INSERT INTO tb_audit_logs VALUES(37,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777330455946);
INSERT INTO tb_audit_logs VALUES(38,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777330519690);
INSERT INTO tb_audit_logs VALUES(39,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777337422618);
INSERT INTO tb_audit_logs VALUES(40,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777337772007);
INSERT INTO tb_audit_logs VALUES(41,12,'Teste','marcoaraujoc@gmail.com','LOGOUT',1777339378238);
INSERT INTO tb_audit_logs VALUES(42,12,'Marco Cunha','marcoaraujoc@gmail.com','LOGOUT',1777395609386);
INSERT INTO tb_audit_logs VALUES(43,12,'Marco Cunha','marcoaraujoc@gmail.com','LOGOUT',1777397415571);
INSERT INTO tb_audit_logs VALUES(44,12,'Marco Cunha','marcoaraujoc@gmail.com','LOGOUT',1777398750722);
INSERT INTO tb_audit_logs VALUES(45,12,'Marco Cunha','marcoaraujoc@gmail.com','LOGOUT',1777409130285);
CREATE TABLE IF NOT EXISTS `users` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `fullName` TEXT NOT NULL,
    `email` TEXT NOT NULL,
    `passwordHash` TEXT NOT NULL,
    `phone` TEXT,
    `role` TEXT NOT NULL DEFAULT 'USER',
    `userType` TEXT NOT NULL DEFAULT 'PROPRIETARIO',
    `cep` TEXT,
    `endereco` TEXT,
    `complemento` TEXT,
    `bairro` TEXT,
    `cidade` TEXT,
    `estado` TEXT,
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `resetPasswordToken` TEXT,
    `resetPasswordExpires` DATETIME
);
INSERT INTO users VALUES(12,'Marco Cunha','marcoaraujoc@gmail.com','$2b$10$1F2J1JWD4NgLPJ.bu5DKTeGSLF1ZzszGAkeSv60szdeElgNOL3HYK','(21) 99432-8820','USER','PROPRIETARIO','20770240','Rua José Bonifácio','101 Bloco 4 Apt 602','Todos os Santos','Rio de Janeiro','RJ',1776985705195,1,'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImlhdCI6MTc3Njk4NzE4MSwiZXhwIjoxNzc2OTkwNzgxfQ.4K7ye54ONuRYh9TRIC0kocfZ7qwZjtAybgGgng7xj7o',1776990781537);
CREATE TABLE IF NOT EXISTS `tb_dieta` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `alimentoId` INTEGER NOT NULL,
    `qtdGramasDia` REAL NOT NULL,
    `periodicidade` TEXT,
    `unidade` TEXT,
    `dataInicio` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `dataFim` DATETIME,
    `horario` TEXT,
    `observacao` TEXT,
    `dataCriacao` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `dataAlteracao` DATETIME NOT NULL,
    `criadopor` INTEGER NOT NULL,
    `modificadopor` INTEGER NOT NULL,
    CONSTRAINT `tb_dieta_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tb_dieta_alimentoId_fkey` FOREIGN KEY (`alimentoId`) REFERENCES `tb_alimentos` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tb_dieta_criadopor_fkey` FOREIGN KEY (`criadopor`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tb_dieta_modificadopor_fkey` FOREIGN KEY (`modificadopor`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO tb_dieta VALUES(11,30,1,69.0,'3x ao dia','Pães',1777510323055,NULL,'01:00','Teste',1777510323055,1777510355241,12,12);
CREATE TABLE IF NOT EXISTS `tb_exames_nutricionais` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `animalId` INTEGER NOT NULL,
    `nutrienteId` INTEGER NOT NULL,
    `dataExame` DATETIME NOT NULL,
    `valorEncontrado` REAL NOT NULL,
    `unidade` TEXT NOT NULL,
    `valorMinRef` REAL,
    `valorMaxRef` REAL,
    `observacao` TEXT, `arquivoUrl` TEXT,
    CONSTRAINT `tb_exames_nutricionais_animalId_fkey` FOREIGN KEY (`animalId`) REFERENCES `tb_animais` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `tb_exames_nutricionais_nutrienteId_fkey` FOREIGN KEY (`nutrienteId`) REFERENCES `tb_nutrientes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('tb_especies',3);
INSERT INTO sqlite_sequence VALUES('tb_racas',2);
INSERT INTO sqlite_sequence VALUES('tb_animal_exercise',33);
INSERT INTO sqlite_sequence VALUES('tb_alimentos',1);
INSERT INTO sqlite_sequence VALUES('tb_nutrientes',3);
INSERT INTO sqlite_sequence VALUES('tb_composicao_alimento',3);
INSERT INTO sqlite_sequence VALUES('tb_animais',31);
INSERT INTO sqlite_sequence VALUES('tb_audit_logs',45);
INSERT INTO sqlite_sequence VALUES('users',12);
INSERT INTO sqlite_sequence VALUES('tb_dieta',11);
INSERT INTO sqlite_sequence VALUES('tb_exames_nutricionais',0);
CREATE UNIQUE INDEX `tb_especies_nome_key` ON `tb_especies`(`nome`);
CREATE UNIQUE INDEX `tb_racas_nome_especieId_key` ON `tb_racas`(`nome`, `especieId`);
CREATE UNIQUE INDEX `tb_composicao_alimento_alimentoId_nutrienteId_key` ON `tb_composicao_alimento`(`alimentoId`, `nutrienteId`);
CREATE UNIQUE INDEX `users_email_key` ON `users`(`email`);
CREATE UNIQUE INDEX `users_resetPasswordToken_key` ON `users`(`resetPasswordToken`);
