'use strict';
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET_EMAIL = process.argv[2];
if (!TARGET_EMAIL) { console.error('Uso: node scripts/import_exercicios_notion.js <email>'); process.exit(1); }

// ── LOCAIS ───────────────────────────────────────────────────────────────────
const LOCAIS = [
  'Orla','CETE','Cidade','G10','União','Suporte 3d','Casa',
  'Parcão ou Redenção','Velocity ou JB','Academia','Rua','Em casa','Parque',
];

// ── TIPOS ────────────────────────────────────────────────────────────────────
const TIPOS = [
  { nome:'Musculação', cat:'forca' },
  { nome:'Corrida',    cat:'cardio' },
  { nome:'Bike',       cat:'cardio' },
  { nome:'Caminhada',  cat:'cardio' },
  { nome:'Natação',    cat:'cardio' },
  { nome:'Funcional',  cat:'forca' },
  { nome:'Escada',     cat:'cardio' },
  { nome:'Crossfit',   cat:'forca' },
  { nome:'Yoga',       cat:'forca' },
];

// ── TREINOS ──────────────────────────────────────────────────────────────────
// [data, hora_inicio, hora_fim, titulo, tipo_cat, tipo_ex, calorias, duracao, descricao, km, local]
const TREINOS_RAW = [
  ['2025-01-25','07:32','08:32','8k','cardio','Corrida',568,53,'6:36',8,'Orla'],
  ['2025-01-07','18:45','19:45','Corridinha pista','cardio','Corrida',342,35,'6:12',5.53,'CETE'],
  ['2025-01-06','18:25','19:30','Corriminhada','cardio','Corrida',479,65,'9:39',6.69,'Cidade'],
  ['2025-01-04','07:27','09:00','Corrida/Caminhada','cardio','Corrida',706,85,'8:12',10.43,'Orla'],
  ['2025-01-14','18:32','19:15','Treino de corrida','cardio','Corrida',443,44,'5:48 (durante os tiros de 1k)',6.4,'CETE'],
  ['2025-01-11','08:32','09:22','7k','cardio','Corrida',502,53,'7:30',7,'Orla'],
  ['2025-01-21','18:40','19:25','Treino de Corrida','cardio','Corrida',378,35,'run 4:49 / rest 6:43',5.42,'CETE'],
  ['2025-01-18','07:08','08:08','Caminhada','cardio','Corrida',280,42,'',4.15,'CETE'],
  ['2025-01-28','18:34','19:15','Treino de corrida','cardio','Corrida',475,44,'run pace 5:14 | avg pace 6:42',6.46,'CETE'],
  ['2025-01-07','08:00','09:00','Funcional','forca','Musculação',267,55,'',null,'G10'],
  ['2025-01-21','08:00','09:00','Funcional','forca','Musculação',211,60,'',null,'G10'],
  ['2025-01-23','11:40','12:40','Funcional','forca','Musculação',266,68,'',null,'G10'],
  ['2025-01-30','08:00','09:00','Funcional','forca','Musculação',231,60,'',null,'G10'],
  ['2025-01-07','06:35','07:20','Natação','cardio','Natação',262,45,'2:38 / 100m',1,'União'],
  ['2025-01-02','16:15','17:15','Nadar','cardio','Natação',265,35,'3:13',0.8,'União'],
  ['2025-01-09','13:00','14:00','Fisio','forca','Musculação',203,50,'',null,'Suporte 3d'],
  ['2025-01-04','18:46','20:00','Funcional em casa','forca','Musculação',282,80,'',null,'Casa'],
  ['2025-01-09','17:39','18:39','Treino de tiro','cardio','Corrida',465,45,'7:07',6.41,'CETE'],
  ['2025-01-12','08:16','13:15','Bike','cardio','Bike',1959,240,'16.6 kph / 3:36',67.22,'Cidade'],
  ['2025-01-11','07:44','08:30','4k Caminhando','cardio','Corrida',248,47,'11:41',4,'Orla'],
  ['2025-01-20','19:00','20:00','Bike (Velocity)','cardio','Bike',402,50,'',null,'Velocity ou JB'],
  ['2025-01-21','12:21','13:00','Natação','cardio','Natação',296,47,'3:02',1.2,'União'],
  ['2025-01-23','06:37','07:37','Teste 3k - 1.75+3k+1.75','cardio','Corrida',472,41,'5:36 no teste',6.5,'CETE'],
  ['2025-01-20','17:25','18:00','Corriminhada','cardio','Corrida',374,45,'',5.2,'Parcão ou Redenção'],
  ['2025-01-25','11:00','12:00','Funcional','forca','Musculação',295,60,'',null,'G10'],
  ['2025-01-28','08:00','09:00','Funcional','forca','Musculação',254,60,'',null,'G10'],
  ['2025-01-29','18:35','19:05','Natação','cardio','Natação',179,30,'2:36',0.8,'União'],
  ['2025-02-04','18:52','19:52','Treino de corrida','cardio','Corrida',499,45,'5:29',6.31,'CETE'],
  ['2025-02-03','18:39','19:54','Corriminhada','cardio','Corrida',353,40,'',4.63,'Cidade'],
  ['2025-01-31','17:47',null,'Caminhada','cardio','Corrida',278,50,'',4.31,'Parcão ou Redenção'],
  ['2025-02-08','06:30','07:45','Longão','cardio','Corrida',646,65,'6:55',9,'Orla'],
  ['2025-02-10','11:45','12:45','Fortalecimento','forca','Musculação',189,42,'',null,'G10'],
  ['2025-02-11','08:00','09:00','Funcional','forca','Musculação',257,55,'',null,'G10'],
  ['2025-02-13','12:00','13:00','Funcional','forca','Musculação',231,50,'',null,'G10'],
  ['2025-02-11','06:36','07:36','Nadar','cardio','Natação',343,45,'2:45',1.2,'União'],
  ['2025-02-12','17:45','18:45','Treino de Corrida','cardio','Corrida',430,40,'6:49 warm up | 5:46 run | 6:51 recovery | 6:57 cool down',6,'CETE'],
  ['2025-02-13','18:30','19:30','Treino de Corrida','cardio','Corrida',461,45,'2k aquece 6:42 | 3x 600m 5:51 + 200m 6:46 | 2k desaquece 7:03',6.46,'CETE'],
  ['2025-02-15','07:20','08:50','Longão','cardio','Corrida',736,65,'6:29',10,'Orla'],
  ['2025-02-18','18:30',null,'Corrida (try and fail)','cardio','Corrida',140,15,'5:46',2,'CETE'],
  ['2025-03-01','06:30','07:30','Corrida','cardio','Corrida',null,null,'',null,'Orla'],
  ['2025-02-23','06:39','07:39','Corrida','cardio','Corrida',582,58,'6:33',8,'Orla'],
  ['2025-03-04','07:15','07:44','Corrida','cardio','Corrida',186,18,'6:59',2.67,'Orla'],
  ['2025-03-04','07:44','08:30','Caminhada','cardio','Corrida',186,39,'',3,'Orla'],
  ['2025-03-06','18:30','20:00','Treino de pista','cardio','Corrida',536,50,'Run 5:57 (6x600m) | WarmUp 6:39 (2k) | Cool down 8:20 (1k)',6.81,'CETE'],
  ['2025-03-09','10:00','11:00','Bike - Just Burn','cardio','Bike',372,50,'',null,'Velocity ou JB'],
  ['2025-03-13','11:30','12:30','Funcional','forca','Musculação',254,60,'',null,'G10'],
  ['2025-03-18','18:30','19:30','Treino de corrida','cardio','Corrida',587,53,'WU 6:25 (2k) | Run 5:35 (8x400) | CD 7:00 (2k)',7.3,'CETE'],
  ['2025-03-20','18:30','19:30','Treino de corrida','cardio','Corrida',612,70,'WU (2k) 6:35 | Run (8x300) 5:52 | CD (2k) 8:24',8,'Parcão ou Redenção'],
  ['2025-03-13','19:00','20:00','Bike','cardio','Bike',461,55,'',null,'Velocity ou JB'],
  ['2025-03-16','07:00','07:45','Corrida','cardio','Corrida',367,33,'6:35',5,'Cidade'],
  ['2025-03-22','06:30','08:00','Corrida','cardio','Corrida',902,80,'6:41',12,'Orla'],
  ['2025-03-15','07:20','08:20','Corrida','cardio','Corrida',509,49,'6:58',7,'Orla'],
  ['2025-03-25','07:50','09:00','Funcional','forca','Musculação',278,65,'',null,'G10'],
  ['2025-03-29','06:30','08:00','Corrida','cardio','Corrida',854,90,'7:20',12,'Orla'],
  ['2025-04-03','17:34','18:34','Corrida','cardio','Corrida',501,45,'WP: 6:30 | RUN (2minX10): 5:57 | RECOVERY (1minX10): 7:32',7,'CETE'],
  ['2025-04-05','07:27','09:00','Corrida','cardio','Corrida',865,83,'6:56',12,'Orla'],
  ['2025-04-08','18:30','19:30','Corrida','cardio','Corrida',445,42,'WU: 7:27 | 7x500m: 5:49',5.77,'CETE'],
  ['2025-04-12','07:04','07:38','5k','cardio','Corrida',365,33,'6:34',5,'Orla'],
  ['2025-04-12','08:03','08:48','Corrida South Summit','cardio','Corrida',367,38,'7:30',5,'Orla'],
  ['2025-04-22','18:34','19:14','Corrida','cardio','Corrida',493,45,'WP 2k 6:28 | 7x 200m Run 5:44 + 200m Rest 6:54 | CD 2k 6:52',6.81,'CETE'],
  ['2025-04-24','18:30','19:30','Corrida','cardio','Corrida',423,38,'6:23',6,'CETE'],
  ['2025-04-30','08:00','09:00','Funcional','forca','Musculação',210,60,'',null,'G10'],
  ['2025-04-29','18:30','19:30','Corrida','cardio','Corrida',478,44,'WP 2K 6:51 | 10x (2min 6:17 + 1min 7:05)',6.6,'CETE'],
  ['2025-05-01','08:31','09:31','Corrida','cardio','Corrida',571,53,'WP 2k 6:24 | 8x 400m 5:43 + 1min descanso | CD 6:47',7.45,'Cidade'],
  ['2025-05-04','07:56','09:26','Corrida','cardio','Corrida',844,110,'6:48',12,'Cidade'],
  ['2025-04-27','06:00','07:15','New Balance','cardio','Corrida',758,67,'6:37',10,'Orla'],
  ['2025-05-05','08:00','09:00','Funcional','forca','Musculação',154,55,'',null,'G10'],
  ['2025-05-06','18:30','19:45','Corrida','cardio','Corrida',577,56,'WU 2k 7:25 | Tiros de 500m 5:50 | CD 2k 6:54',7.72,'CETE'],
  ['2025-05-08','18:30','19:45','Corrida','cardio','Corrida',549,60,'WU 2K 7:35 | 4x800m 5:51 | 1m30s rest | CD 2k 6:35',7.4,'CETE'],
  ['2025-05-10','06:34','08:19','Corrida','cardio','Corrida',997,102,'7:19',14,'Orla'],
  ['2025-05-11','07:15','08:00','Corrida - Outono','cardio','Corrida',366,35,'7:07',5,'Orla'],
  ['2025-05-13','08:00','09:00','Funcional','forca','Musculação',248,65,'',null,'G10'],
  ['2025-05-15','18:30','19:45','Corrida','cardio','Corrida',620,65,'WU 6:26 | 4x1k 5:43 | CD 6:48',8.1,'CETE'],
  ['2025-05-17','06:45','08:30','Corrida','cardio','Corrida',1200,115,'7:00',16.41,'Orla'],
  ['2025-05-21','17:00','18:00','Corrida','cardio','Corrida',715,70,'WU 2k 6:39 | 10x500m 5:52 | CD 2k 8:24',9.17,'Parcão ou Redenção'],
  ['2025-05-22','07:22','08:22','Funcional','forca','Musculação',286,82,'',null,'G10'],
  ['2025-05-24','06:45','08:30','Corrida','cardio','Corrida',1305,130,'7:15',18,'Orla'],
  ['2025-06-05','08:00','09:00','Funcional','forca','Musculação',278,60,'',null,'G10'],
  ['2025-06-07','07:06','11:21','Meia Maratona de POA <3','cardio','Corrida',1680,155,'7:14',21.46,'Cidade'],
  ['2025-06-10','08:00','09:00','Funcional','forca','Musculação',192,50,'',null,'G10'],
  ['2025-06-15','07:18','08:00','Circuito das Estações','cardio','Corrida',368,39,'7:43',5,'Orla'],
  ['2025-06-16','08:00','09:00','Funcional','forca','Musculação',183,50,'',null,'G10'],
  ['2025-06-16','12:00','13:00','Caminhada','cardio','Corrida',322,55,'',4,'Cidade'],
  ['2025-06-21','07:51','08:51','Caminhada','cardio','Corrida',396,60,'',6,'Orla'],
  ['2025-06-24','18:00','19:00','Corrida','cardio','Corrida',447,45,'WU 2K 6:37 | 7x400m 5:53 | CD 0.85m 6:37',5.86,'CETE'],
  ['2025-07-19','07:53','08:53','Corrida','cardio','Corrida',441,50,'8:01',6,'Orla'],
  ['2025-07-29','08:00','09:00','Funcional','forca','Musculação',220,60,'',null,'G10'],
  ['2025-08-09','07:30','08:30','Corrida','cardio','Corrida',null,null,'',null,'Orla'],
  ['2025-08-12','18:06','19:06','Corrida','cardio','Corrida',426,41,'WP 1.6km 7:00 | 6x300m 5:47 | CD 1.6km 7:34',5.6,'CETE'],
  ['2025-08-16','07:43','08:30','Corrida','cardio','Corrida',431,44,'7:15',6,'Orla'],
  ['2025-09-02','07:00','08:00','Funcional','forca','Musculação',250,60,'',null,'G10'],
  ['2025-09-02','18:06','18:46','Corrida','cardio','Corrida',417,40,'',5.09,'CETE'],
  ['2025-09-06','08:12','09:00','Corrida','cardio','Corrida',336,48,'',5,'Orla'],
  ['2025-09-06','14:53','15:23','Bike em casa','cardio','Bike',206,30,'',10,'Casa'],
  ['2025-09-07','13:12','14:00','Bike em casa','cardio','Bike',283,45,'',15,'Casa'],
  ['2025-09-09','18:34','19:04','Bike em casa','cardio','Bike',209,32,'10min aquecimento | 2x 1FO 2FR | 2x 2FO 2FR | 2x 1FO 2FR',10,'Casa'],
  ['2025-09-10','17:00','18:00','Bike','cardio','Bike',402,55,'',20,'Casa'],
  ['2025-09-13','19:00','20:00','Bike','cardio','Bike',97,20,'',null,'Casa'],
  ['2025-09-14','07:32','08:47','Corrida','cardio','Corrida',383,38,'7:31',5,'Orla'],
  ['2025-09-15','19:04','20:04','Bike lendo','cardio','Bike',305,52,'23.3km/h',20,'Casa'],
  ['2025-09-16','07:09','08:09','Funcional','forca','Musculação',283,56,'',null,'G10'],
  ['2025-09-16','08:12','08:42','Bike','cardio','Bike',186,30,'19,6km/h',10,'Casa'],
  ['2025-09-17','18:30','19:30','Bike Hiit','cardio','Bike',301,36,'',10,'Casa'],
  ['2025-09-20','07:33','08:48','Corrida','cardio','Corrida',427,52,'8:34',6,'Orla'],
  ['2025-09-23','12:15','13:15','Bike','cardio','Bike',304,45,'20km/h',15,'Casa'],
  ['2025-09-23','19:00','20:00','Bike','cardio','Bike',140,20,'',null,'Casa'],
  ['2025-09-27','07:48','08:30','Corrida','cardio','Corrida',435,45,'7:23',6,'Orla'],
  ['2025-09-29','18:00','19:00','Bike','cardio','Bike',494,70,'',25,'Casa'],
  ['2025-10-01','18:26','19:06','Bike','cardio','Bike',219,33,'',12,'Casa'],
  ['2025-10-04','07:26','08:26','Corrida','cardio','Corrida',363,54,'',5.5,'Orla'],
  ['2025-10-11','07:05','08:05','Corrida','cardio','Corrida',405,58,'9:42',6,'Orla'],
  ['2025-10-14','16:30','17:30','Bike','cardio','Bike',163,31,'',10,'Casa'],
  ['2025-10-29','09:15','10:00','1 – Treino 1','forca','Musculação',309,50,'',null,'União'],
  ['2025-11-03','17:00','18:00','1 – Treino 2','forca','Musculação',200,50,'',null,'União'],
  ['2025-11-05','18:30','19:30','2 – T1','forca','Musculação',338,45,'',null,'União'],
  ['2025-11-10','06:50','07:50','Bike','cardio','Bike',246,50,'',15,'Casa'],
  ['2025-11-17','07:30','08:30','Musculação','forca','Musculação',283,40,'',null,'União'],
  ['2025-11-18','12:43','13:43','Musculação','forca','Musculação',342,50,'',null,'União'],
  ['2025-11-22','07:17','08:17','Corrida','cardio','Corrida',342,47,'',5,'Orla'],
  ['2025-11-22','08:00','09:00','Musculação','forca','Musculação',343,40,'',null,'União'],
  ['2025-11-27','07:39','08:39','Musculação','forca','Musculação',232,45,'',null,'União'],
  ['2025-12-04','07:45','08:30','Musculação','forca','Musculação',257,45,'',null,'União'],
  ['2025-12-08','07:33','08:13','Musc T2','forca','Musculação',189,45,'',null,'União'],
  ['2025-12-08','08:15','08:25','Escada','cardio','Escada',112,12,'',null,'União'],
  ['2025-12-16','07:37','08:22','Musc T1','forca','Musculação',203,39,'',null,'União'],
  ['2025-12-17','08:00','08:45','Musc T2','forca','Musculação',286,50,'',null,'União'],
  ['2025-12-22','18:00','18:30','Musc T1','forca','Musculação',254,35,'',null,'União'],
  ['2025-12-22','18:31','18:41','Escada','cardio','Escada',104,10,'',null,'União'],
  ['2025-12-29','07:40','08:30','Musc B','forca','Musculação',256,50,'',null,'União'],
  ['2025-12-30','14:45','15:15','Bike','cardio','Bike',232,30,'',11,'Casa'],
  ['2025-12-30','18:15','19:00','Corrida','cardio','Corrida',425,47,'',5.25,'União'],
  ['2025-12-31','07:45','08:30','Musc A','forca','Musculação',221,45,'',null,'União'],
  ['2025-12-31','16:10','16:40','Bike','cardio','Bike',209,30,'',10,'Casa'],
  ['2026-01-01','19:23','19:53','Bike','cardio','Bike',146,30,'',11,'Casa'],
  ['2026-01-02','18:00','18:40','Bike','cardio','Bike',167,40,'',13.5,'Casa'],
  ['2026-01-03','10:43','11:03','Corrida','cardio','Corrida',213,23,'',3,'União'],
  ['2026-01-03','11:05','11:25','Escada','cardio','Escada',150,15,'',null,'União'],
  ['2026-01-07','18:30','19:15','Musc A','forca','Musculação',273,40,'',null,'União'],
  ['2026-01-10','16:00','16:30','Bike','cardio','Bike',343,65,'',20,'Casa'],
  ['2026-01-11','18:16','18:46','Bike','cardio','Bike',143,28,'',10,'Casa'],
  ['2026-01-12','18:10','18:40','Bike','cardio','Bike',147,30,'',10,'Casa'],
  ['2026-01-14','07:15','08:15','Musc B','forca','Musculação',167,40,'',null,'União'],
  ['2026-01-15','18:23','18:59','Musc A','forca','Musculação',249,35,'',null,'União'],
  ['2026-01-15','19:05','19:25','Corrida','cardio','Corrida',195,25,'',null,'União'],
  ['2026-01-16','18:24','19:00','Bike','cardio','Bike',173,29,'',10,'Casa'],
  ['2026-01-17','16:53','17:50','Bike','cardio','Bike',321,54,'',20,'Casa'],
  ['2026-01-18','18:15','18:45','Bike','cardio','Bike',167,28,'',10,'Casa'],
  ['2026-01-20','18:00','19:00','Corrida','cardio','Corrida',421,44,'',4.83,'União'],
  ['2026-01-21','13:14','13:45','Bike','cardio','Bike',211,28,'',10,'Casa'],
  ['2026-01-22','07:40','08:40','Musc B','forca','Musculação',368,60,'',null,'União'],
  ['2026-01-25','19:40','20:10','Bike','cardio','Bike',169,30,'',10,'Casa'],
  ['2026-01-26','15:35','16:15','Musc A','forca','Musculação',316,44,'',null,'União'],
  ['2026-01-26','16:21','16:31','Escada','cardio','Escada',128,11,'',null,'União'],
  ['2026-01-28','17:50','18:35','Corrida','cardio','Corrida',382,43,'Esteira – tiros de 2min a 6:39',4.8,'União'],
  ['2026-01-29','19:50','20:20','Bike','cardio','Bike',179,29,'',10,'Casa'],
  ['2026-01-31','15:50','16:40','Musc B','forca','Musculação',417,50,'',null,'União'],
  ['2026-01-31','16:45','17:15','Corrida','cardio','Corrida',317,30,'',3,'União'],
  ['2026-02-02','18:30','20:30','Bike','cardio','Bike',690,122,'',42.2,'Casa'],
  ['2026-02-03','07:48','08:48','Musc A','forca','Musculação',186,42,'',null,'União'],
  ['2026-02-04','07:49','08:30','Caminhada','cardio','Caminhada',220,38,'',2.94,'Parcão ou Redenção'],
  ['2026-02-09','07:08','08:00','Treino novo (B)','forca','Musculação',275,55,'',null,'União'],
  ['2026-02-11','15:18','16:00','Corrida','cardio','Corrida',537,47,'',null,'União'],
  ['2026-02-12','17:15','18:15','Bike','cardio','Bike',null,null,'',null,'Casa'],
  ['2026-02-14','07:34','08:15','Corrida','cardio','Corrida',330,32,'',4.14,'Orla'],
  ['2026-02-14','08:16','09:00','Caminhada','cardio','Caminhada',187,30,'',2.65,'Orla'],
  ['2026-02-23','07:45','08:30','Treino A','forca','Musculação',259,45,'',null,'União'],
  ['2026-02-28','06:40','07:25','Corrida','cardio','Corrida',285,45,'',4,'Orla'],
  ['2026-03-02','18:20','18:50','Bike','cardio','Bike',148,31,'',10,'Casa'],
  ['2026-03-03','18:17','18:47','Corrida','cardio','Corrida',349,33,'',4,'CETE'],
  ['2026-03-04','11:05','11:45','Treino B','forca','Musculação',260,40,'',null,'União'],
  ['2026-03-04','17:15','17:45','Bike','cardio','Bike',165,30,'',10,'Casa'],
  ['2026-03-05','19:00','19:30','Bike','cardio','Bike',159,32,'',10,'Casa'],
  ['2026-03-06','13:00','13:35','Corrida','cardio','Corrida',300,35,'',null,'União'],
  ['2026-03-13','18:00','19:15','Bike','cardio','Bike',145,30,'',10,'Casa'],
  ['2026-03-14','07:26','08:30','Corrida','cardio','Corrida',395,55,'',5.25,'Orla'],
  ['2026-03-14','15:35','16:25','Musc A','forca','Musculação',299,45,'',null,'União'],
  ['2026-03-15','10:15','11:15','Musc B','forca','Musculação',224,40,'',null,'União'],
  ['2026-03-16','07:15','07:35','Escada','cardio','Escada',200,20,'',null,'União'],
  ['2026-03-17','17:25','18:00','Musc A','forca','Musculação',254,37,'',null,'União'],
  ['2026-03-17','18:45','19:15','Bike','cardio','Bike',216,30,'',10,'Casa'],
  ['2026-03-18','11:09','11:54','Musc B','forca','Musculação',207,32,'',null,'União'],
  ['2026-03-18','17:30','18:00','Bike','cardio','Bike',187,30,'',null,'Casa'],
  ['2026-03-20','17:45','18:45','Bike','cardio','Bike',279,55,'',20,'Casa'],
  ['2026-03-23','18:05','18:35','Bike','cardio','Bike',141,30,'',10,'Casa'],
  ['2026-03-29','13:45','14:00','Aquecimento','cardio','Caminhada',59,10,'',null,'União'],
  ['2026-03-29','14:00','14:45','Musc A','forca','Musculação',247,50,'',null,'União'],
  ['2026-03-30','18:34','19:34','Bike','cardio','Bike',344,70,'',22.5,'Casa'],
  ['2026-03-31','06:54','07:20','Bike ida pra corrida','cardio','Bike',248,23,'',4.19,'Cidade'],
  ['2026-03-31','07:27','08:00','Corrida','cardio','Corrida',247,28,'',2.92,'Parcão ou Redenção'],
  ['2026-03-31','08:09','08:30','Bike volta da corrida','cardio','Bike',271,25,'',3.22,'Cidade'],
  ['2026-04-04','08:50','10:50','Bike','cardio','Bike',1064,120,'Rodagem',24.24,'Cidade'],
  ['2026-04-05','19:15','19:35','Bike','cardio','Bike',104,20,'',5,'Casa'],
  ['2026-04-06','07:32','07:52','Bike','cardio','Bike',140,40,'',10,'Casa'],
];

async function main() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) { console.error('Usuário não encontrado:', TARGET_EMAIL); process.exit(1); }
  const userId = user.id;
  console.log(`Importando para usuário: ${user.nome} (${userId})`);

  // Upsert locais
  console.log('→ Inserindo locais...');
  for (const nome of LOCAIS) {
    const cid = 'import_local_' + nome.replace(/\s+/g,'_').toLowerCase();
    await prisma.apiLocalTreino.upsert({
      where: { userId_client_id: { userId, client_id: cid } },
      update: { nome },
      create: { userId, client_id: cid, nome },
    });
  }

  // Upsert tipos
  console.log('→ Inserindo tipos de exercício...');
  for (const t of TIPOS) {
    const cid = 'import_tipo_' + t.nome.replace(/\s+/g,'_').toLowerCase();
    await prisma.apiTipoExercicio.upsert({
      where: { userId_client_id: { userId, client_id: cid } },
      update: { nome: t.nome, cat: t.cat },
      create: { userId, client_id: cid, nome: t.nome, cat: t.cat },
    });
  }

  // Upsert treinos
  console.log(`→ Inserindo ${TREINOS_RAW.length} treinos...`);
  let ok = 0, skip = 0;
  for (let i = 0; i < TREINOS_RAW.length; i++) {
    const [data, hora_inicio, hora_fim, titulo, tipo_cat, tipo_ex, calorias, duracao, descricao, km, local_nome] = TREINOS_RAW[i];
    const cid = `notion_treino_${i}_${data}_${(hora_inicio||'').replace(':','')}`;
    try {
      await prisma.apiTreino.upsert({
        where: { userId_client_id: { userId, client_id: cid } },
        update: { titulo, data, hora_inicio, hora_fim, tipo_cat, tipo_ex, calorias, duracao, descricao: descricao||null, km: km!=null?String(km):null, local_nome },
        create: { userId, client_id: cid, titulo, data, hora_inicio, hora_fim, tipo_cat, tipo_ex, calorias, duracao, descricao: descricao||null, km: km!=null?String(km):null, local_nome },
      });
      ok++;
      if (ok % 20 === 0) process.stdout.write(`  ${ok}/${TREINOS_RAW.length}\r`);
    } catch(e) {
      console.error(`  Erro no treino ${i} (${titulo} ${data}):`, e.message);
      skip++;
    }
  }
  console.log(`\n✓ Concluído: ${ok} treinos importados, ${skip} erros.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
