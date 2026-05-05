-- Tabela users corrigida para MySQL
CREATE TABLE IF NOT EXISTS `users` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
    `fullName` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(30),
    `role` VARCHAR(50) NOT NULL DEFAULT 'USER',
    `userType` VARCHAR(50) NOT NULL DEFAULT 'PROPRIETARIO',
    `cep` VARCHAR(10),
    `endereco` VARCHAR(255),
    `complemento` VARCHAR(100),
    `bairro` VARCHAR(100),
    `cidade` VARCHAR(100),
    `estado` VARCHAR(2),
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `ativo` BOOLEAN NOT NULL DEFAULT true,
    `resetPasswordToken` VARCHAR(255),
    `resetPasswordExpires` DATETIME,
    UNIQUE KEY `users_email_key` (`email`),
    UNIQUE KEY `users_resetPasswordToken_key` (`resetPasswordToken`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dados
INSERT INTO `users` VALUES
(12,'Marco Cunha','marcoaraujoc@gmail.com','$2b$10$1F2J1JWD4NgLPJ.bu5DKTeGSLF1ZzszGAkeSv60szdeElgNOL3HYK','(21) 99432-8820','USER','PROPRIETARIO','20770240','Rua José Bonifácio','101 Bloco 4 Apt 602','Todos os Santos','Rio de Janeiro','RJ','2025-04-23 10:08:15',1,'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIsImlhdCI6MTc3Njk4NzE4MSwiZXhwIjoxNzc2OTkwNzgxfQ.4K7ye54ONuRYh9TRIC0kocfZ7qwZjtAybgGgng7xj7o','2025-04-23 11:13:57');
