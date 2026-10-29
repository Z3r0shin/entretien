/* Modèle de départ : la liste « Entretien Préventif » (G. Leblanc, 9 nov. 2022)
   + des ajouts suggérés tirés de référents publics (désactivés par défaut).
   Tâche = [nom, fréquence en jours (0 = au besoin), source, note]. */
window.EP_DATA = {
  version: 1,
  sources: {
    RBQ: { name: 'RBQ – Registre d\'inspection du bâtiment (Code de sécurité, chap. Bâtiment)', url: 'https://www.rbq.gouv.qc.ca/domaines-dintervention/batiment/interpretation-directives-techniques-et-administratives/chapitre-batiment-du-code-de-securite/registre-dinspection-du-batiment/' },
    CNPI: { name: 'CNPI 2020 modifié Québec (art. 6.5.1.6 à 6.5.1.8, éclairage de sécurité)', url: 'https://www.rbq.gouv.qc.ca/vous-etes/proprietaire-ou-exploitant/les-exigences-de-qualite-et-de-securite/chapitre-batiment-du-code-de-securite/exigences-du-code-national-de-prevention-des-incendies/' },
    SHQ: { name: 'SHQ – Calendrier d\'entretien préventif des immeubles', url: 'https://www.quebec.ca/habitation-territoire/espace-partenaires-informations-habitation/guides-references-partenaires-habitation/entretien-preventif-immeubles-partenaires-habitation' },
    MEQ_VENT: { name: 'MEQ – Guide d\'entretien des systèmes de ventilation en milieu scolaire', url: 'https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/education/publications-adm/infrastructures/Guide-entretien-systemes-ventilation.pdf' },
    MEQ_MOIS: { name: 'MEQ – Guide de gestion de la prolifération des moisissures en milieu scolaire', url: 'https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/education/publications-adm/education/Guide-moisissures-milieu-scolaire.pdf' },
    MEQ_AIR: { name: 'MEQ – Qualité de l\'air dans les écoles (CO₂, MERV 13)', url: 'https://www.quebec.ca/education/prescolaire-primaire-et-secondaire/administration-encadrements/infrastructures-scolaires/qualite-air-ecoles' },
    MEQ_SPORT: { name: 'MELS/FCSQ – Entretien de l\'équipement sportif (guide de bonnes pratiques)', url: 'https://cssbe.gouv.qc.ca/documents/CSSBE/a_propos/DG_Services_adm/RM/Guide_de_bonnes_pratiques.pdf' },
    INSPQ_JEU: { name: 'INSPQ – Guide des aires et appareils de jeu (CSA Z614)', url: 'https://www.inspq.qc.ca/publications/395' },
    CNESST_EC: { name: 'CNESST – Espaces clos (RSST art. 297 et suivants)', url: 'https://www.cnesst.gouv.qc.ca/fr/prevention-securite/identifier-corriger-risques/liste-informations-prevention/espaces-clos' },
    RBQ_DAR: { name: 'RBQ – Dispositifs antirefoulement (vérification annuelle par vérificateur certifié)', url: 'https://www.rbq.gouv.qc.ca/vous-etes/proprietaire-ou-exploitant/les-exigences-de-qualite-et-de-securite/dispositif-antirefoulement/' },
    ASHRAE: { name: 'ASHRAE – IAQ Preventive Maintenance Checklist', url: 'https://www.ashrae.org/file%20library/technical%20resources/ieq%20resources/iaq-preventive-maintenance-checklist.pdf' },
    FED: { name: 'Gouv. du Canada – devis d\'entretien d\'immeuble (Affaires mondiales, SOW 22-198066)', url: 'https://canadabuys.canada.ca/documents/pub/att/2022/09/30/ccd567a86571a32c1b6ed9ab2430cf03/22-198066_-_annex_a_sow_-_eng.pdf' },
    SUG: { name: 'Suggestion (pratique courante, à ajuster)', url: '' }
  },
  base: [
    { name: 'Extérieur', items: [
      { name: 'Portes/Fenêtres', tasks: [
        ['Caulking', 365, 'SHQ', 'Murs extérieurs et joints : vérification annuelle en mai.'],
        ['Coupe-froids + Brosses', 182, 'SUG', 'Printemps et avant l\'hiver.'],
        ['Huiler + Graisser', 182, 'SUG'],
        ['Peinture', 365, 'SUG'],
        ['Numéros', 365, 'SUG']]},
      { name: 'Clôture', tasks: [
        ['Portes/Accès', 30, 'SUG'],
        ['Frost', 182, 'SUG', 'Soulèvement par le gel : printemps et automne.']]},
      { name: 'Égouts', tasks: [
        ['Nettoyer', 365, 'SHQ', 'Puisards : débris, parois, cloche, affouillement autour.']]},
      { name: 'Jeux/Modules', tasks: [
        ['Stabilité/Sécurité', 30, 'INSPQ_JEU', 'CSA Z614 : visuel quotidien/hebdo, inspection mensuelle consignée, inspection annuelle détaillée par personne formée.']]},
      { name: 'Drapeau', tasks: [
        ['Vérifier', 30, 'SUG', 'Drapeau, corde, poulie, mât.']]},
      { name: 'Conteneurs', tasks: [
        ['Peinture', 365, 'SHQ', 'Contenants à déchets : juin.']]},
      { name: 'Toit', tasks: [
        ['Nettoyer Général', 182, 'SHQ', 'Toit plat : mai et octobre.'],
        ['Nettoyer Drains/Évents', 182, 'MEQ_MOIS', 'Drains ni obstrués ni gelés.'],
        ['Vérifier Tiges Drains', 182, 'SHQ'],
        ['Vérifier Machines', 91, 'FED', 'Courroies, roulements : trimestriel (devis fédéral). Cadenasser avant d\'intervenir (RSST 188.1+).'],
        ['Vérifier Ventilation', 182, 'MEQ_VENT', 'Prises d\'air : inspection visuelle aux 6 mois.']]},
      { name: 'Végétation', tasks: [
        ['Tailler', 182, 'SHQ', 'Mai et octobre.']]},
      { name: 'Pancartes', tasks: [
        ['Fumée/Cigarette', 365, 'SUG'],
        ['Nom de l\'École', 365, 'SUG'],
        ['Autres Pancartes', 365, 'SUG']]}
    ]},
    { name: 'Intérieur', items: [
      { name: 'Portes/Fenêtres', tasks: [
        ['Numéros de Locaux', 365, 'SUG'],
        ['Huiler + Graisser', 182, 'SUG'],
        ['Pieds Portes + Butoirs', 182, 'SUG'],
        ['Poignées', 91, 'SUG'],
        ['Vérifier Vis', 182, 'SUG'],
        ['Coupe-Fumée', 30, 'RBQ', 'Ferme-portes et dispositifs de maintien : mensuel. Portes coupe-feu fermées et non bloquées : quotidien.']]},
      { name: 'Plafonds', tasks: [
        ['Vérifier Tuiles', 365, 'MEQ_MOIS', 'Traces d\'eau = infiltration à chercher. Inspection annuelle avant la rentrée.']]},
      { name: 'Planchers', tasks: [
        ['Vérifier Tuiles', 365, 'SHQ', 'Revêtements de plancher : novembre.'],
        ['Vérifier Plinthes', 365, 'SHQ']]},
      { name: 'Toilettes', tasks: [
        ['Targettes + Butoirs', 91, 'SUG'],
        ['Huiler + Graisser Portes', 182, 'SUG']]},
      { name: 'Salles Mécaniques', tasks: [
        ['Étiquettes + Indications', 365, 'SUG'],
        ['Nettoyer', 91, 'SUG']]},
      { name: 'Peinture', tasks: [
        ['Petites Surfaces Seul.', 0, 'SUG', 'Au besoin.']]},
      { name: 'Pancartes', tasks: [
        ['Extincteurs', 30, 'RBQ', 'Mensuel : en place, visible, accessible, manomètre au vert, goupille et sceau. Entretien annuel par une firme (NFPA 10).'],
        ['Autres Pancartes', 365, 'SUG']]},
      { name: 'Jeux/Modules', tasks: [
        ['Vérifier Jeux Gymnase', 30, 'MEQ_SPORT', 'Grille mensuelle, inspection détaillée annuelle début mai.']]},
      { name: 'Espaces Clos', tasks: [
        ['Vérifier et Nettoyer', 365, 'CNESST_EC', 'Ne jamais entrer seul : procédure écrite, mesure de l\'atmosphère, ventilation, surveillant, plan de sauvetage.']]},
      { name: 'Ventilation', tasks: [
        ['Vérifier Grilles', 365, 'MEQ_VENT', 'Diffuseurs et grilles dégagés : annuel.']]}
    ]}
  ],
  suggested: [
    { name: 'Sécurité incendie', items: [
      { name: 'Éclairage d\'urgence', tasks: [
        ['Essai mensuel (bouton test, voyants, bornes)', 30, 'CNPI'],
        ['Essai de durée (min. 30 min)', 365, 'CNPI', 'Annuel. Peut être fait par le propriétaire (Guide RBQ).']]},
      { name: 'Enseignes de sortie', tasks: [
        ['Allumées, visibles, intactes', 30, 'CNPI', 'Mensuel si à batterie, sinon annuel.']]},
      { name: 'Portes d\'issue', tasks: [
        ['Barre antipanique + ferme-porte', 30, 'RBQ', 'Mensuel (fiche RBQ mécanismes de fermeture).'],
        ['Issues dégagées, non verrouillées', 30, 'RBQ', 'Le Code exige une vérification quotidienne des portes coupe-feu (souvent faite par le concierge).']]},
      { name: 'Alarme incendie', tasks: [
        ['Panneau : aucun signal de dérangement', 30, 'RBQ', 'Essais annuels par une firme (CAN/ULC-S536).'],
        ['Détecteurs non obstrués, non peints', 365, 'SHQ']]},
      { name: 'Extincteurs', tasks: [
        ['Étiquette d\'entretien annuel à jour', 365, 'RBQ', 'Entretien annuel et essais hydrostatiques par une firme spécialisée.']]}
    ]},
    { name: 'Enveloppe et terrain', items: [
      { name: 'Murs/Fondations', tasks: [
        ['Fissures, joints de mortier, efflorescence', 365, 'SHQ', 'Mai.'],
        ['Solins et couronnements', 365, 'SHQ'],
        ['Chantepleures dégagées', 182, 'MEQ_MOIS', 'Printemps et fin d\'automne.']]},
      { name: 'Toit', tasks: [
        ['Membrane : boursouflures, ventres-de-bœuf, solins', 182, 'SHQ', 'Mai et octobre.'],
        ['Inspection après tempête', 0, 'SUG', 'Au besoin.']]},
      { name: 'Gouttières/Descentes', tasks: [
        ['Dégagées, bien raccordées, pente du terrain', 182, 'MEQ_MOIS']]},
      { name: 'Prises d\'air', tasks: [
        ['Grilles pare-oiseaux propres (feuilles, fientes)', 182, 'MEQ_VENT']]},
      { name: 'Combles/Entretoit', tasks: [
        ['Givre, isolant, trappe, séparations coupe-feu', 365, 'SHQ', 'Avril.']]},
      { name: 'Stationnement/Trottoirs', tasks: [
        ['Nids-de-poule, fissures, bordures, lignes', 365, 'SHQ', 'Juin. Sceller les fissures avant le gel.']]},
      { name: 'Escaliers/Rampes ext.', tasks: [
        ['Ancrages garde-corps et mains courantes', 365, 'SHQ', 'Juin.']]},
      { name: 'Buts de soccer', tasks: [
        ['Ancrage et stabilité', 30, 'MEQ_SPORT', 'Boucher les fourreaux quand le but est retiré.']]},
      { name: 'Électricité extérieure', tasks: [
        ['Éclairage et prises extérieures', 365, 'SHQ', 'Septembre.']]}
    ]},
    { name: 'Intérieur (ajouts)', items: [
      { name: 'Eau/Moisissures', tasks: [
        ['Traces d\'eau, odeurs, locaux peu utilisés', 365, 'MEQ_MOIS', 'Avant la rentrée. Vérifier derrière les meubles collés aux murs extérieurs.'],
        ['Isolant des tuyaux d\'eau froide', 365, 'MEQ_MOIS']]},
      { name: 'Drains de plancher', tasks: [
        ['Remplir les siphons (garde d\'eau)', 30, 'MEQ_MOIS', 'Les siphons secs laissent entrer les odeurs d\'égout.']]},
      { name: 'Escaliers/Rampes int.', tasks: [
        ['Mains courantes, nez de marche', 365, 'SHQ', 'Novembre.']]},
      { name: 'Gymnase', tasks: [
        ['Paniers de basket : ancrages, antichute', 30, 'MEQ_SPORT'],
        ['Rideaux diviseurs : câble, poulies, arrêt d\'urgence', 30, 'MEQ_SPORT'],
        ['Grilles de protection des luminaires', 365, 'MEQ_SPORT']]}
    ]},
    { name: 'Mécanique', items: [
      { name: 'Ventilation', tasks: [
        ['Filtres : pression différentielle / changement', 182, 'MEQ_VENT', 'Au minimum automne et printemps. MERV 13 si possible (MEQ).'],
        ['Volets d\'air extérieur et biellettes', 91, 'MEQ_VENT'],
        ['Courroies et roulements', 91, 'FED'],
        ['Bacs de condensat et drains', 91, 'FED', 'Hebdo en saison de climatisation (MEQ).'],
        ['Lecteurs de CO₂ en place et fonctionnels', 30, 'MEQ_AIR', 'Cible < 1000 ppm en classe.']]},
      { name: 'Plomberie', tasks: [
        ['Puisard + pompe : flotteurs, alarme, clapet', 365, 'SHQ', 'Avril.'],
        ['Robinets d\'arrêt principaux : manœuvrer', 365, 'SHQ', 'Septembre.'],
        ['Robinets extérieurs : vidanger avant le gel', 365, 'SHQ', 'Septembre.'],
        ['Antirefoulement : étiquette d\'essai annuel à jour', 365, 'RBQ_DAR', 'Essai par un vérificateur certifié.'],
        ['Chauffe-eau', 365, 'SHQ', 'Juillet.']]}
    ]}
  ]
};
