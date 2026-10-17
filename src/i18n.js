'use strict';
/* irlab editor: js/i18n.js. One of the editor's scripts, loaded in order by index.html as plain
   (non-module) scripts that share one global scope. Order matters: see the list in index.html. */

/* ?selftest runs the built-in colour check (see runSelfTest). It must never touch the saved session. */
const SELFTEST = /[?&]selftest(&|=|$)/.test(location.search);
/* The self-test's code and baseline live in editor-selftest.js (built from src/selftest.js), fetched only for ?selftest.
   It shares this script's globals, so it is added once the editor has finished running. */
if (SELFTEST) setTimeout(() => { const s = document.createElement('script'); s.src = 'editor-selftest.js?b=' + (window.IRLAB_BUILD || ''); document.body.appendChild(s); }, 0);
const I18N = {
  en: { demosaicLabel:'Demosaic', slotIdle:'Insert file', slotBusy:'Reading', secLoad:'Load', secDecode:'Decode', secTools:'Tools', whatsNewLabel:'What\u2019s new', languageLabel:'Language', hotspotRemoval:'Hotspot removal', fringing:'Colour fringing', dockLooks:'Looks', dockLight:'Light', dockColour:'Colour', dockDetail:'Detail', dockExport:'Export', maskColour:'Colour', maskPick:'Pick colour', selfTest:'Self-test', localAdj:'Local adjustments', maskAdd:'Add', maskLinear:'Linear', maskRadial:'Radial', maskLum:'Luminosity', maskInvert:'Invert', maskShow:'Show mask', maskDelete:'Delete mask', cropFree:'Free', cropOriginal:'Original', cropReset:'Reset crop', toneCurve:'Tone curve', lensCorrection:'Lens correction', scopeHist:'Histogram', scopeParade:'Parade', fineTag:'fine', cropTitle:'Crop', introTitle:'Upload an IR/UV Photo', chooseImage:'Choose image',
    btnHome:'Home', btnResetAll:'Reset all', undo:'Undo', redo:'Redo',
    step01:'Targeted Colour', step02:'Channel Swap', step03:'White Balance', step04:'Light', step05:'Colour', step06:'Export',
    subhdrUV:'UV Presets', subhdrIR:'IR Presets', filmStocksRecipes:'Film stocks & recipes', myPresets:'My Presets',
    saveCurrentLook:'Save current look as preset', clearFilter:'Clear filter', autoTone:'Auto tone',
    preSwapNeutral:'Pick grey', clearPre:'Clear', postSwapNeutral:'Pick grey', clearPost:'Clear',
    quickPreviewOption:'Use quick preview instead of full sensor decode', wideGamutSwapOption:'Try: wider-gamut colour swap (often more accurate)',
    gamutSwapCaveat:'Needs a RAW with the camera\u2019s colour data \u2014 no effect otherwise.',
    tagline:'Darkroom for light you can\u2019t see' },
  es: { demosaicLabel:'Demosaico', slotIdle:'Insertar archivo', slotBusy:'Leyendo', secLoad:'Cargar', secDecode:'Decodificación', secTools:'Herramientas', whatsNewLabel:'Novedades', languageLabel:'Idioma', hotspotRemoval:'Eliminación de puntos calientes', fringing:'Bordes de color', dockLooks:'Estilos', dockLight:'Luz', dockColour:'Color', dockDetail:'Detalle', dockExport:'Exportar', maskColour:'Color', maskPick:'Elegir color', selfTest:'Autodiagnóstico', localAdj:'Ajustes locales', maskAdd:'Añadir', maskLinear:'Lineal', maskRadial:'Radial', maskLum:'Luminosidad', maskInvert:'Invertir', maskShow:'Mostrar máscara', maskDelete:'Eliminar máscara', cropFree:'Libre', cropOriginal:'Original', cropReset:'Restablecer recorte', toneCurve:'Curva de tonos', lensCorrection:'Corrección de lente', scopeHist:'Histograma', scopeParade:'Parade RGB', fineTag:'fino', cropTitle:'Recorte', introTitle:'Subir una foto IR/UV', chooseImage:'Elegir imagen',
    btnHome:'Inicio', btnResetAll:'Restablecer todo', undo:'Deshacer', redo:'Rehacer',
    step01:'Color dirigido', step02:'Intercambio de canales', step03:'Balance de blancos', step04:'Luz', step05:'Color', step06:'Exportar',
    subhdrUV:'Preajustes UV', subhdrIR:'Preajustes IR', filmStocksRecipes:'Emulsiones y recetas', myPresets:'Mis preajustes',
    saveCurrentLook:'Guardar look actual como preajuste', clearFilter:'Quitar filtro', autoTone:'Tono automático',
    preSwapNeutral:'Elegir gris', clearPre:'Borrar', postSwapNeutral:'Elegir gris', clearPost:'Borrar',
    quickPreviewOption:'Usar la vista previa rápida en vez de la decodificación completa', wideGamutSwapOption:'Prueba: intercambio de color de gama más amplia (suele ser más preciso)',
    gamutSwapCaveat:'Requiere un RAW con los datos de color de la cámara; si no, no tiene efecto.',
    tagline:'Cuarto oscuro para la luz que no puedes ver' },
  fr: { demosaicLabel:'Dématriçage', slotIdle:'Insérer un fichier', slotBusy:'Lecture', secLoad:'Charger', secDecode:'Décodage', secTools:'Outils', whatsNewLabel:'Nouveautés', languageLabel:'Langue', hotspotRemoval:'Suppression du point chaud', fringing:'Franges de couleur', dockLooks:'Styles', dockLight:'Lumière', dockColour:'Couleur', dockDetail:'Détail', dockExport:'Exporter', maskColour:'Couleur', maskPick:'Choisir la couleur', selfTest:'Autotest', localAdj:'Réglages locaux', maskAdd:'Ajouter', maskLinear:'Linéaire', maskRadial:'Radial', maskLum:'Luminosité', maskInvert:'Inverser', maskShow:'Afficher le masque', maskDelete:'Supprimer le masque', cropFree:'Libre', cropOriginal:'Original', cropReset:'Réinitialiser le recadrage', toneCurve:'Courbe des tons', lensCorrection:'Correction d\u2019objectif', scopeHist:'Histogramme', scopeParade:'Parade RVB', fineTag:'fin', cropTitle:'Recadrage', introTitle:'Importer une photo IR/UV', chooseImage:'Choisir une image',
    btnHome:'Accueil', btnResetAll:'Tout réinitialiser', undo:'Annuler', redo:'Rétablir',
    step01:'Couleur ciblée', step02:'Permutation des canaux', step03:'Balance des blancs', step04:'Lumière', step05:'Couleur', step06:'Exporter',
    subhdrUV:'Préréglages UV', subhdrIR:'Préréglages IR', filmStocksRecipes:'Émulsions et recettes', myPresets:'Mes préréglages',
    saveCurrentLook:'Enregistrer ce rendu comme préréglage', clearFilter:'Retirer le filtre', autoTone:'Ton automatique',
    preSwapNeutral:'Choisir un gris', clearPre:'Effacer', postSwapNeutral:'Choisir un gris', clearPost:'Effacer',
    quickPreviewOption:'Utiliser l\u2019aperçu rapide au lieu du décodage complet', wideGamutSwapOption:'À essayer : permutation de couleur à gamme plus large (souvent plus précise)',
    gamutSwapCaveat:'Nécessite un RAW avec les données colorimétriques de l\u2019appareil, sinon aucun effet.',
    tagline:'Chambre noire pour la lumière invisible' },
  de: { demosaicLabel:'Demosaicing', slotIdle:'Datei einlegen', slotBusy:'Wird gelesen', secLoad:'Laden', secDecode:'Dekodierung', secTools:'Werkzeuge', whatsNewLabel:'Neuigkeiten', languageLabel:'Sprache', hotspotRemoval:'Hotspot-Entfernung', fringing:'Farbsäume', dockLooks:'Looks', dockLight:'Licht', dockColour:'Farbe', dockDetail:'Detail', dockExport:'Export', maskColour:'Farbe', maskPick:'Farbe wählen', selfTest:'Selbsttest', localAdj:'Lokale Anpassungen', maskAdd:'Hinzufügen', maskLinear:'Linear', maskRadial:'Radial', maskLum:'Luminanz', maskInvert:'Umkehren', maskShow:'Maske anzeigen', maskDelete:'Maske löschen', cropFree:'Frei', cropOriginal:'Original', cropReset:'Zuschnitt zurücksetzen', toneCurve:'Tonwertkurve', lensCorrection:'Objektivkorrektur', scopeHist:'Histogramm', scopeParade:'RGB-Parade', fineTag:'fein', cropTitle:'Zuschnitt', introTitle:'IR-/UV-Foto hochladen', chooseImage:'Bild auswählen',
    btnHome:'Start', btnResetAll:'Alles zurücksetzen', undo:'Rückgängig', redo:'Wiederholen',
    step01:'Gezielte Farbe', step02:'Kanaltausch', step03:'Weißabgleich', step04:'Licht', step05:'Farbe', step06:'Exportieren',
    subhdrUV:'UV-Voreinstellungen', subhdrIR:'IR-Voreinstellungen', filmStocksRecipes:'Filmtypen & Rezepte', myPresets:'Meine Voreinstellungen',
    saveCurrentLook:'Aktuellen Look als Voreinstellung speichern', clearFilter:'Filter entfernen', autoTone:'Auto-Ton',
    preSwapNeutral:'Grau wählen', clearPre:'Löschen', postSwapNeutral:'Grau wählen', clearPost:'Löschen',
    quickPreviewOption:'Schnellvorschau statt vollständiger Sensor-Dekodierung verwenden', wideGamutSwapOption:'Ausprobieren: Farbtausch mit größerem Farbraum (oft genauer)',
    gamutSwapCaveat:'Erfordert ein RAW mit den Farbdaten der Kamera \u2013 sonst ohne Wirkung.',
    tagline:'Dunkelkammer für Licht, das man nicht sehen kann' },
  ja: { demosaicLabel:'デモザイク', slotIdle:'ファイルを挿入', slotBusy:'読み込み中', secLoad:'読み込み', secDecode:'デコード', secTools:'ツール', whatsNewLabel:'新機能', languageLabel:'言語', hotspotRemoval:'ホットスポット除去', fringing:'色のにじみ', dockLooks:'ルック', dockLight:'光', dockColour:'色', dockDetail:'ディテール', dockExport:'書き出し', maskColour:'カラー', maskPick:'色を選択', selfTest:'セルフテスト', localAdj:'ローカル補正', maskAdd:'追加', maskLinear:'線形', maskRadial:'円形', maskLum:'輝度', maskInvert:'反転', maskShow:'マスクを表示', maskDelete:'マスクを削除', cropFree:'自由', cropOriginal:'元の比率', cropReset:'切り抜きをリセット', toneCurve:'トーンカーブ', lensCorrection:'レンズ補正', scopeHist:'ヒストグラム', scopeParade:'RGBパレード', fineTag:'微調整', cropTitle:'切り抜き', introTitle:'IR/UV写真をアップロード', chooseImage:'画像を選択',
    btnHome:'ホーム', btnResetAll:'すべてリセット', undo:'元に戻す', redo:'やり直す',
    step01:'対象カラー', step02:'チャンネル入れ替え', step03:'ホワイトバランス', step04:'ライト', step05:'カラー', step06:'書き出し',
    subhdrUV:'UVプリセット', subhdrIR:'IRプリセット', filmStocksRecipes:'フィルムストック・レシピ', myPresets:'マイプリセット',
    saveCurrentLook:'現在の見た目をプリセットとして保存', clearFilter:'フィルターを解除', autoTone:'オートトーン',
    preSwapNeutral:'グレーを選択', clearPre:'クリア', postSwapNeutral:'グレーを選択', clearPost:'クリア',
    quickPreviewOption:'フルセンサーデコードの代わりにクイックプレビューを使用', wideGamutSwapOption:'試してみる: 広色域カラースワップ(より正確なことが多い)',
    gamutSwapCaveat:'カメラのカラーデータを含むRAWが必要です。ない場合は効果がありません。',
    tagline:'見えない光のための暗室' },
  zh: { demosaicLabel:'去马赛克', slotIdle:'插入文件', slotBusy:'读取中', secLoad:'载入', secDecode:'解码', secTools:'工具', whatsNewLabel:'新功能', languageLabel:'语言', hotspotRemoval:'热斑消除', fringing:'色边校正', dockLooks:'风格', dockLight:'光线', dockColour:'色彩', dockDetail:'细节', dockExport:'导出', maskColour:'颜色', maskPick:'选取颜色', selfTest:'自检', localAdj:'局部调整', maskAdd:'添加', maskLinear:'线性', maskRadial:'径向', maskLum:'亮度', maskInvert:'反转', maskShow:'显示蒙版', maskDelete:'删除蒙版', cropFree:'自由', cropOriginal:'原始比例', cropReset:'重置裁剪', toneCurve:'色调曲线', lensCorrection:'镜头校正', scopeHist:'直方图', scopeParade:'RGB分量图', fineTag:'精细', cropTitle:'裁剪', introTitle:'上传红外/紫外照片', chooseImage:'选择图片',
    btnHome:'主页', btnResetAll:'全部重置', undo:'撤销', redo:'重做',
    step01:'定向颜色', step02:'通道互换', step03:'白平衡', step04:'光照', step05:'颜色', step06:'导出',
    subhdrUV:'紫外预设', subhdrIR:'红外预设', filmStocksRecipes:'胶片与配方', myPresets:'我的预设',
    saveCurrentLook:'将当前效果保存为预设', clearFilter:'清除滤镜', autoTone:'自动色调',
    preSwapNeutral:'选取灰色', clearPre:'清除', postSwapNeutral:'选取灰色', clearPost:'清除',
    quickPreviewOption:'使用快速预览,而非完整传感器解码', wideGamutSwapOption:'试试看:更广色域的颜色互换(通常更准确)',
    gamutSwapCaveat:'需要包含相机色彩数据的RAW文件,否则不会有效果。',
    tagline:'为看不见的光而生的暗房' },
};
/* Build 127: text added since build 110 (cards, white balance rows, top bar labels, the home prompt, the mix grid), merged
   into each language. */
const I18N_127 = {"en": {"cSrc": "Source channels", "cSrcS": "which one carries your signal", "cSwap": "Swap & mix", "cSwapS": "swap buttons and the mix grid", "cPre": "Presets", "cPreS": "UV and IR swaps", "cFilmS": "and your own presets", "cStr": "Strength & IR tone", "cStrS": "preset strength, tone curve", "cTT": "Temperature & tint", "cTTS": "a deliberate cast on top", "cHl": "Highlight recovery", "cHlS": "RAW files only", "cExp": "Exposure", "cExpS": "exposure and brightness", "cTone": "Tone", "cToneS": "contrast, highlights, shadows", "cBW": "Black & white point", "cBWS": "where black and white sit", "cCurveS": "RGB and each channel", "cLocS": "linear, radial, luminosity, colour", "cOv": "Overall", "cOvS": "hue, saturation, vibrance", "cBand": "Colour by band", "cCal": "Calibration", "cCalS": "primaries and shadow tint", "cWs": "Swap working space", "cWsS": "how wide the swap works", "cLutS": "optional colour grade", "cHotS": "bright centre patch from the lens", "cNoise": "Noise", "cNoiseS": "grain and colour speckle", "cSharp": "Sharpening", "cSharpS": "edge acuity after demosaic", "cClar": "Clarity & dehaze", "cClarS": "local contrast and haze", "cTm": "Tone mapping", "cTmS": "compress big light differences", "cFrS": "coloured edges toward the corners", "cDec": "Decode settings", "cDecS": "for the next photo you open", "cCropS": "aspect ratios", "cFmt": "Format", "cFmtS": "TIFF, PNG or JPEG", "cRes": "Resolution", "cResS": "working or full size", "cBatch": "Batch", "cBatchS": "apply this look to many files", "wbPick": "Grey pickers", "wbPickS": "tap the dropper, then something grey", "wbBefore": "Before swap", "wbAfter": "After swap", "notSet": "not set", "wbGains": "Channel gains", "autoShort": "✦ Auto", "rNew": "New", "rHome": "Home", "rReset": "Reset", "rLeft": "Left", "rRight": "Right", "rFull": "Full", "rTheme": "Theme", "rFilters": "Filters", "ltReady": "irlab ready · RAW decoder:", "ltReading": "reading photo…", "ltOpen": "open photo", "ltHint": "tap, or drop a file", "mxHint": "Tap a cell to tune it on the bar, tap again to type. Drag a cell sideways to scrub it.", "mxPrev": "Colours before / after", "mxOff": "Offsets", "mxOffNote": "Added to the channel whatever the input, so it can tint deep shadows a mix alone can’t reach.", "decFull": "full sensor", "decQuick": "quick preview", "decWide": "wide-gamut swap"}, "es": {"cSrc": "Canales de origen", "cSrcS": "cuál lleva tu señal", "cSwap": "Intercambio y mezcla", "cSwapS": "botones de intercambio y cuadrícula de mezcla", "cPre": "Ajustes preestablecidos", "cPreS": "intercambios UV e IR", "cFilmS": "y tus propios ajustes", "cStr": "Intensidad y tono IR", "cStrS": "intensidad del ajuste, curva tonal", "cTT": "Temperatura y matiz", "cTTS": "un tono intencionado encima", "cHl": "Recuperación de luces", "cHlS": "solo archivos RAW", "cExp": "Exposición", "cExpS": "exposición y brillo", "cTone": "Tono", "cToneS": "contraste, luces, sombras", "cBW": "Punto negro y blanco", "cBWS": "dónde quedan el negro y el blanco", "cCurveS": "RGB y cada canal", "cLocS": "lineal, radial, luminosidad, color", "cOv": "General", "cOvS": "tono, saturación, intensidad", "cBand": "Color por banda", "cCal": "Calibración", "cCalS": "primarios y matiz de sombras", "cWs": "Espacio de trabajo del intercambio", "cWsS": "qué amplitud usa el intercambio", "cLutS": "gradación de color opcional", "cHotS": "mancha brillante central del objetivo", "cNoise": "Ruido", "cNoiseS": "grano y moteado de color", "cSharp": "Enfoque", "cSharpS": "nitidez de bordes tras el demosaico", "cClar": "Claridad y neblina", "cClarS": "contraste local y neblina", "cTm": "Mapeo tonal", "cTmS": "comprime grandes diferencias de luz", "cFrS": "bordes de color hacia las esquinas", "cDec": "Ajustes de decodificación", "cDecS": "para la próxima foto que abras", "cCropS": "proporciones", "cFmt": "Formato", "cFmtS": "TIFF, PNG o JPEG", "cRes": "Resolución", "cResS": "tamaño de trabajo o completo", "cBatch": "Lote", "cBatchS": "aplica este estilo a muchos archivos", "wbPick": "Selectores de gris", "wbPickS": "toca el cuentagotas y luego algo gris", "wbBefore": "Antes del intercambio", "wbAfter": "Después del intercambio", "notSet": "sin ajustar", "wbGains": "Ganancias de canal", "autoShort": "✦ Auto", "rNew": "Abrir", "rHome": "Inicio", "rReset": "Reset", "rLeft": "Izq.", "rRight": "Der.", "rFull": "Ampliar", "rTheme": "Tema", "rFilters": "Filtros", "ltReady": "irlab listo · decodificador RAW:", "ltReading": "leyendo foto…", "ltOpen": "abrir foto", "ltHint": "toca o suelta un archivo", "mxHint": "Toca una celda para ajustarla en la barra; tócala otra vez para escribir. Arrástrala hacia los lados para variarla.", "mxPrev": "Colores antes / después", "mxOff": "Desplazamientos", "mxOffNote": "Se suma al canal sea cual sea la entrada, así puede teñir sombras profundas que la mezcla sola no alcanza.", "decFull": "sensor completo", "decQuick": "vista rápida", "decWide": "intercambio de gama amplia"}, "fr": {"cSrc": "Canaux source", "cSrcS": "lequel porte votre signal", "cSwap": "Échange et mixage", "cSwapS": "boutons d’échange et grille de mixage", "cPre": "Préréglages", "cPreS": "échanges UV et IR", "cFilmS": "et vos propres préréglages", "cStr": "Intensité et tonalité IR", "cStrS": "intensité du préréglage, courbe", "cTT": "Température et teinte", "cTTS": "une dominante voulue par-dessus", "cHl": "Récupération des hautes lumières", "cHlS": "fichiers RAW uniquement", "cExp": "Exposition", "cExpS": "exposition et luminosité", "cTone": "Tonalité", "cToneS": "contraste, hautes lumières, ombres", "cBW": "Point noir et blanc", "cBWS": "où se placent le noir et le blanc", "cCurveS": "RVB et chaque canal", "cLocS": "linéaire, radial, luminosité, couleur", "cOv": "Global", "cOvS": "teinte, saturation, vibrance", "cBand": "Couleur par bande", "cCal": "Calibrage", "cCalS": "primaires et teinte des ombres", "cWs": "Espace de travail de l’échange", "cWsS": "l’étendue sur laquelle l’échange agit", "cLutS": "étalonnage facultatif", "cHotS": "tache claire au centre due à l’objectif", "cNoise": "Bruit", "cNoiseS": "grain et moucheture colorée", "cSharp": "Netteté", "cSharpS": "piqué des contours après dématriçage", "cClar": "Clarté et correction du voile", "cClarS": "contraste local et voile", "cTm": "Mappage des tons", "cTmS": "compresse les grands écarts de lumière", "cFrS": "contours colorés vers les coins", "cDec": "Réglages de décodage", "cDecS": "pour la prochaine photo ouverte", "cCropS": "formats d’image", "cFmt": "Format", "cFmtS": "TIFF, PNG ou JPEG", "cRes": "Résolution", "cResS": "taille de travail ou taille réelle", "cBatch": "Lot", "cBatchS": "appliquer ce rendu à plusieurs fichiers", "wbPick": "Pipettes de gris", "wbPickS": "touchez la pipette, puis une zone grise", "wbBefore": "Avant l’échange", "wbAfter": "Après l’échange", "notSet": "non défini", "wbGains": "Gains des canaux", "autoShort": "✦ Auto", "rNew": "Ouvrir", "rHome": "Accueil", "rReset": "Réinit.", "rLeft": "Gauche", "rRight": "Droite", "rFull": "Plein", "rTheme": "Thème", "rFilters": "Filtres", "ltReady": "irlab prêt · décodeur RAW :", "ltReading": "lecture de la photo…", "ltOpen": "ouvrir une photo", "ltHint": "touchez ou déposez un fichier", "mxHint": "Touchez une case pour la régler sur la barre, touchez à nouveau pour saisir. Faites-la glisser latéralement pour la faire varier.", "mxPrev": "Couleurs avant / après", "mxOff": "Décalages", "mxOffNote": "Ajouté au canal quelle que soit l’entrée : il peut teinter les ombres profondes qu’un mixage seul n’atteint pas.", "decFull": "capteur complet", "decQuick": "aperçu rapide", "decWide": "échange gamme étendue"}, "de": {"cSrc": "Quellkanäle", "cSrcS": "welcher dein Signal trägt", "cSwap": "Tausch & Mischung", "cSwapS": "Tausch-Tasten und Mischraster", "cPre": "Vorgaben", "cPreS": "UV- und IR-Tausch", "cFilmS": "und eigene Vorgaben", "cStr": "Stärke & IR-Tonwert", "cStrS": "Vorgabenstärke, Tonkurve", "cTT": "Temperatur & Tönung", "cTTS": "ein bewusster Farbstich obendrauf", "cHl": "Lichterrettung", "cHlS": "nur RAW-Dateien", "cExp": "Belichtung", "cExpS": "Belichtung und Helligkeit", "cTone": "Tonwerte", "cToneS": "Kontrast, Lichter, Tiefen", "cBW": "Schwarz- & Weißpunkt", "cBWS": "wo Schwarz und Weiß liegen", "cCurveS": "RGB und jeder Kanal", "cLocS": "linear, radial, Luminanz, Farbe", "cOv": "Gesamt", "cOvS": "Farbton, Sättigung, Dynamik", "cBand": "Farbe nach Band", "cCal": "Kalibrierung", "cCalS": "Grundfarben und Tiefentönung", "cWs": "Arbeitsfarbraum des Tauschs", "cWsS": "wie weit der Tausch arbeitet", "cLutS": "optionale Farbgebung", "cHotS": "heller Mittelfleck vom Objektiv", "cNoise": "Rauschen", "cNoiseS": "Korn und Farbsprenkel", "cSharp": "Schärfen", "cSharpS": "Kantenschärfe nach dem Demosaicing", "cClar": "Klarheit & Dunst entfernen", "cClarS": "lokaler Kontrast und Dunst", "cTm": "Tonemapping", "cTmS": "große Helligkeitsunterschiede verdichten", "cFrS": "farbige Kanten zu den Ecken hin", "cDec": "Dekodier-Einstellungen", "cDecS": "für das nächste geöffnete Foto", "cCropS": "Seitenverhältnisse", "cFmt": "Format", "cFmtS": "TIFF, PNG oder JPEG", "cRes": "Auflösung", "cResS": "Arbeits- oder volle Größe", "cBatch": "Stapel", "cBatchS": "diesen Look auf viele Dateien anwenden", "wbPick": "Graupipetten", "wbPickS": "Pipette antippen, dann etwas Graues", "wbBefore": "Vor dem Tausch", "wbAfter": "Nach dem Tausch", "notSet": "nicht gesetzt", "wbGains": "Kanalverstärkung", "autoShort": "✦ Auto", "rNew": "Neu", "rHome": "Start", "rReset": "Reset", "rLeft": "Links", "rRight": "Rechts", "rFull": "Voll", "rTheme": "Thema", "rFilters": "Filter", "ltReady": "irlab bereit · RAW-Decoder:", "ltReading": "Foto wird gelesen…", "ltOpen": "Foto öffnen", "ltHint": "antippen oder Datei ablegen", "mxHint": "Tippe auf eine Zelle, um sie am Regler einzustellen; nochmals tippen zum Eintippen. Seitlich ziehen zum Verstellen.", "mxPrev": "Farben vorher / nachher", "mxOff": "Versätze", "mxOffNote": "Wird unabhängig vom Eingang zum Kanal addiert und kann so tiefe Schatten tönen, die eine Mischung allein nicht erreicht.", "decFull": "voller Sensor", "decQuick": "Schnellvorschau", "decWide": "Weitfarbraum-Tausch"}, "ja": {"cSrc": "ソースチャンネル", "cSrcS": "どのチャンネルに信号があるか", "cSwap": "入れ替えとミックス", "cSwapS": "入れ替えボタンとミックス表", "cPre": "プリセット", "cPreS": "UVとIRの入れ替え", "cFilmS": "とマイプリセット", "cStr": "強さとIRトーン", "cStrS": "プリセットの強さ、トーンカーブ", "cTT": "色温と色かぶり", "cTTS": "意図的な色味を上乗せ", "cHl": "ハイライト復元", "cHlS": "RAWファイルのみ", "cExp": "露出", "cExpS": "露出と明るさ", "cTone": "トーン", "cToneS": "コントラスト、ハイライト、シャドウ", "cBW": "黒点と白点", "cBWS": "黒と白の位置", "cCurveS": "RGBと各チャンネル", "cLocS": "線形・円形・輝度・カラー", "cOv": "全体", "cOvS": "色相・彩度・自然な彩度", "cBand": "帯域別カラー", "cCal": "キャリブレーション", "cCalS": "原色とシャドウの色味", "cWs": "入れ替えの作業色空間", "cWsS": "入れ替えが働く範囲", "cLutS": "任意のカラーグレード", "cHotS": "レンズによる中央の明るい斑", "cNoise": "ノイズ", "cNoiseS": "粒状感とカラーノイズ", "cSharp": "シャープ", "cSharpS": "デモザイク後のエッジの鮮鋭さ", "cClar": "明瞭度とかすみ除去", "cClarS": "ローカルコントラストとかすみ", "cTm": "トーンマッピング", "cTmS": "大きな明暗差を圧縮", "cFrS": "四隅に向かう色づいたエッジ", "cDec": "デコード設定", "cDecS": "次に開く写真用", "cCropS": "縦横比", "cFmt": "形式", "cFmtS": "TIFF・PNG・JPEG", "cRes": "解像度", "cResS": "作業サイズかフルサイズ", "cBatch": "一括処理", "cBatchS": "このルックを複数ファイルに適用", "wbPick": "グレーピッカー", "wbPickS": "スポイトをタップし、灰色の部分をタップ", "wbBefore": "入れ替え前", "wbAfter": "入れ替え後", "notSet": "未設定", "wbGains": "チャンネルゲイン", "autoShort": "✦ 自動", "rNew": "新規", "rHome": "ホーム", "rReset": "リセット", "rLeft": "左回転", "rRight": "右回転", "rFull": "拡大", "rTheme": "テーマ", "rFilters": "フィルター", "ltReady": "irlab 準備完了 · RAWデコーダー:", "ltReading": "写真を読み込み中…", "ltOpen": "写真を開く", "ltHint": "タップ、またはファイルをドロップ", "mxHint": "セルをタップするとバーで調整、もう一度タップで入力。横にドラッグで値を変更。", "mxPrev": "色の変化（前／後）", "mxOff": "オフセット", "mxOffNote": "入力に関係なくチャンネルに加算されるので、ミックスだけでは届かない深いシャドウにも色を付けられます。", "decFull": "フルセンサー", "decQuick": "クイックプレビュー", "decWide": "広色域の入れ替え"}, "zh": {"cSrc": "源通道", "cSrcS": "哪个通道承载信号", "cSwap": "互换与混合", "cSwapS": "互换按钮和混合网格", "cPre": "预设", "cPreS": "紫外与红外互换", "cFilmS": "以及你的预设", "cStr": "强度与红外色调", "cStrS": "预设强度、色调曲线", "cTT": "色温与色调", "cTTS": "在上面叠加有意的偏色", "cHl": "高光恢复", "cHlS": "仅限RAW文件", "cExp": "曝光", "cExpS": "曝光与亮度", "cTone": "色调", "cToneS": "对比度、高光、阴影", "cBW": "黑点与白点", "cBWS": "黑白的位置", "cCurveS": "RGB及各通道", "cLocS": "线性、径向、亮度、颜色", "cOv": "整体", "cOvS": "色相、饱和度、自然饱和度", "cBand": "按波段调色", "cCal": "校准", "cCalS": "原色与阴影色调", "cWs": "互换工作空间", "cWsS": "互换的作用范围", "cLutS": "可选调色", "cHotS": "镜头造成的中央亮斑", "cNoise": "噪点", "cNoiseS": "颗粒与彩色斑点", "cSharp": "锐化", "cSharpS": "去马赛克后的边缘锐度", "cClar": "清晰度与去雾", "cClarS": "局部对比度与雾霾", "cTm": "色调映射", "cTmS": "压缩较大的明暗差", "cFrS": "边角处的彩色边缘", "cDec": "解码设置", "cDecS": "用于下一张打开的照片", "cCropS": "宽高比", "cFmt": "格式", "cFmtS": "TIFF、PNG或JPEG", "cRes": "分辨率", "cResS": "工作尺寸或原始尺寸", "cBatch": "批处理", "cBatchS": "将此效果应用到多个文件", "wbPick": "灰色取样器", "wbPickS": "点击吸管，再点灰色的地方", "wbBefore": "互换前", "wbAfter": "互换后", "notSet": "未设置", "wbGains": "通道增益", "autoShort": "✦ 自动", "rNew": "新建", "rHome": "首页", "rReset": "重置", "rLeft": "左转", "rRight": "右转", "rFull": "全屏", "rTheme": "主题", "rFilters": "滤镜", "ltReady": "irlab 就绪 · RAW解码器：", "ltReading": "正在读取照片…", "ltOpen": "打开照片", "ltHint": "点击，或拖入文件", "mxHint": "点击单元格可在滑条上微调，再点一次可输入数值。横向拖动单元格可快速调整。", "mxPrev": "颜色 前／后", "mxOff": "偏移", "mxOffNote": "不论输入如何都会加到该通道上，因此能为仅靠混合无法触及的深暗部着色。", "decFull": "完整传感器", "decQuick": "快速预览", "decWide": "广色域互换"}};
Object.keys(I18N_127).forEach(l => { if (I18N[l]) Object.assign(I18N[l], I18N_127[l]); });
function detectUILang() {
  const saved = (() => { try { return localStorage.getItem('uiLang'); } catch(e) { return null; } })();
  if (saved && I18N[saved]) return saved;
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return I18N[nav] ? nav : 'en';
}
let uiLang = detectUILang();
function applyUILang() {
  const dict = I18N[uiLang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll('[data-i18n-lbl]').forEach(el => {
    const v = dict[el.getAttribute('data-i18n-lbl')] || I18N.en[el.getAttribute('data-i18n-lbl')];
    if (v) el.setAttribute('data-lbl', v);
  });
  ['wbPreShort', 'wbPostShort'].forEach(id => { const e = $(id); if (e && !e.closest('.wbRow.on')) e.textContent = dict.notSet || 'not set'; });
  const sel = $('uiLang');
  if (sel) sel.value = uiLang;
  // everything without a data-i18n key: matched by its English text (i18n/tr.js, build 133)
  if (window.irlabTr) irlabTr.set(uiLang);
}
document.addEventListener('DOMContentLoaded', () => {
  applyUILang();
  const sel = $('uiLang');
  if (sel) sel.addEventListener('change', () => {
    uiLang = sel.value;
    try { localStorage.setItem('uiLang', uiLang); } catch(e) {}
    applyUILang();
  });
});

const MCELLS = ['m00','m01','m02','m10','m11','m12','m20','m21','m22'];
/* The offset column, deliberately NOT part of MCELLS. A lot of code iterates
   MCELLS assuming exactly nine gain cells \u2014 presets, drag-scrub, the swap
   buttons, the preview swatches \u2014 and widening that array would have made
   every one of them read an offset as if it were a gain. */
const MOFFCELLS = ['m03','m13','m23'];
let engine = null, preWB = [1, 1, 1], postWB = [1, 1, 1], loadedImage = null, pickMode = null;
let wbMethod = 'bradford';   // the only method now — see bradfordAdaptMatrix's comment
let hueSpace = 'perceptual';   // 'perceptual' (OKLab) | 'channel' (HSV) — see hsvRotate's comment
let lumPreserve = false;   // hold luminance across the swap — see preserveLuma
let filmOn = false;        // built-in Aerochrome LUT — see decodeFilmLUT
/* Mirrors of three checkboxes, kept because captureState must see the value
   as it was BEFORE the click. A change handler runs after the browser has
   already flipped the checkbox, so reading .checked at arm time snapshots the
   NEW state and undo restores straight back to it — the toggle appears to do
   nothing. filmOn avoided this by mirroring into a variable assigned after
   arming; these now do the same. */
let camMatchOn = false, filmToneOn = false;
/* A user LUT running at the EARLY stage rather than the end. Separate from
   currentLUT (which grades at the very end, on top of everything) because
   the two answer different questions: currentLUT is "grade the finished
   picture", preLUTUser is "this LUT IS the transform, give it the raw
   image". Kept apart from filmOn so neither has to masquerade as the other. */
let preLUTUser = null;
const IDENTITY3 = [1,0,0, 0,1,0, 0,0,1];
let preWBM = IDENTITY3, postWBM = IDENTITY3;
let indexMode = 0;   // 0 off, 1 NDVI, 2 NGB — see the shader note
let contrastPivot = 0.5;   // median tone of the source; see the shader note
let targetedBands = [];   // {id, hue, width, dH, dS, dL, swatch}
/* Index of the band whose selection is being shown, or null. Held here
   rather than on the band so it never survives into a saved state or an
   export — it is a transient editing aid, not part of the look. */
let bandPreviewIndex = null;
let bandNextId = 1;
const BAND_MAX = 5;
// Shared chroma ceiling across ALL targeted-colour bands combined — see the
// long comment in targetedHSLF where this is applied for why it exists.
// The GLSL shader's targetedHSL() carries the SAME number as a hardcoded
// `const float MAX_CHROMA_MULT` (GLSL can't read a JS constant), so if this
// value ever changes, that one must be changed to match by hand, or the
// live preview and an exported .cube will disagree on how bands compound.
const MAX_CHROMA_MULT = 1.6;
let currentLUT = null; // {size,domainMin,domainMax,data:Float32Array}
let origFile = null, origW = 0, origH = 0, exifSegment = null;
/* ---------- theme switching ----------

   Shares the storage key with the filter page, so the choice carries across
   the two tools rather than each remembering separately.

   The scopes (histogram, channel strips) are canvases: they hold pixels, not
   styles, so CSS cannot restyle them and they have to be redrawn. The image
   preview is deliberately NOT redrawn or retinted — it is a photograph, and
   its surround stays dark in both themes for the same reason a darkroom easel
   is not white. */
function applyTheme(mode,persist){
  const el=document.documentElement;
  if(mode==='light')el.setAttribute('data-theme','light');
  else el.removeAttribute('data-theme');
  if(persist){ try{ localStorage.setItem('irlabTheme',mode); }catch(e){} }
  const b=document.getElementById('themeBtn');
  if(b){
    /* Shows the theme the button will switch you TO. */
    b.textContent = mode==='light' ? '\u263e' : '\u2600';
    b.title = 'Switch to '+(mode==='light'?'dark':'light')+' mode';
    b.setAttribute('aria-label','Switch to '+(mode==='light'?'dark':'light')+' mode');
  }
  try{ if(typeof drawHistogram==='function')drawHistogram(); }catch(e){}
  try{ if(typeof drawChannelStrip==='function')drawChannelStrip(); }catch(e){}
  try{ if(typeof render==='function')render(); }catch(e){}
}
function currentTheme(){
  return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';
}
(function initTheme(){
  const wire=()=>{
    const b=document.getElementById('themeBtn');
    if(!b)return;
    applyTheme(currentTheme(),false);
    b.addEventListener('click',()=>applyTheme(currentTheme()==='light'?'dark':'light',true));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire);
  else wire();
  if(window.matchMedia){
    const mq=window.matchMedia('(prefers-color-scheme: light)');
    const onChange=e=>{
      let stored=null;
      try{ stored=localStorage.getItem('irlabTheme'); }catch(_){}
      if(!stored)applyTheme(e.matches?'light':'dark',false);
    };
    if(mq.addEventListener)mq.addEventListener('change',onChange);
    else if(mq.addListener)mq.addListener(onChange);
  }
})();

const WORKING_MAX_DIM = 2048;
const LE=(()=>{const b=new ArrayBuffer(2);new Uint16Array(b)[0]=1;return new Uint8Array(b)[0]===1;})();

let LAST_LINEAR_FLOAT = null;   // see rawEngineResultToCanvas
let rawCanvas = document.createElement('canvas');
let rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
let rawPixels = null; // cached getImageData().data for the working-size source
let sourceImg = null; // decoded source, kept so rotation can redraw without reloading
let srcOrient = 1;    // EXIF orientation from the RAW header, plus any manual turns

const UV_PRESETS = [
  { n: "Bug vision", m: [0,100,0, 0,0,100, 100,0,0] }
];

/* Preset audit note: 590nm / 665nm / 720nm were three separate buttons all
   loading the identical R<->B swap, and 550nm was identical to Aerochrome
   because its distinguishing hue offset had been dropped. Consolidated to
   genuinely distinct entries — each one below is a different matrix, or the
   same matrix with a real hue offset. `hue` is optional and sets the Hue
   shift slider; `sub` variants subtract IR bleed from G and B for cleaner
   colour separation. */
/* Named by OPERATION, not by filter.

   The old names were filter names — "550nm", "Aerochrome", "Pink & Teal" —
   which promised something a matrix cannot deliver. A 3x3 has no idea what
   glass was in front of the lens: the identical R-B swap produces pink
   foliage with a teal sky on a 550nm capture and white foliage with a deep
   blue sky on a 720nm one. Naming a preset after a filter meant people picked
   the one matching their filter and got a result that looked nothing like the
   reviews, because the capture was doing the work, not the matrix. Each
   preset now says what it does, with a note on what to expect per filter.

   Two of the old six were also broken outright:

   - "550nm" and "Aerochrome" held byte-identical matrices, differing only by
     a 15 degree hue nudge. That is not two presets.

   - "Pink & Teal" mapped BOTH green and blue output from the red input, so
     green always equalled blue. That confines every possible output to two
     hues, 0 and 180 degrees - pure red and pure cyan, with no route to
     magenta at all. It was the one preset in the list mathematically
     incapable of producing pink and teal. The cyclic rotation already does
     it properly (foliage lands near 348 degrees, sky near 188), so the
     broken one is gone rather than patched. */
const IR_PRESETS = [
  { n: "R-B swap",        s: "550nm \u2192 pink & teal \u00b7 720nm \u2192 white foliage, blue sky",
    m: [0,0,100, 0,100,0, 100,0,0] },
  { n: "R-B swap + IR sub", s: "same, minus 30% IR from green and blue \u00b7 darker, cleaner",
    m: [0,0,100, 0,100,-30, 100,0,-30] },
  /* Completes the pairwise-swap set alongside R-B swap and B-G swap below.
     Untested against a real IR/UV photo \u2014 unlike the others in this list,
     the subtitle makes no claim about resulting hues, since (per the note
     above this array) the same matrix looks different on every filter and
     that can only be said with a measured photo in hand. */
  { n: "R-G swap", s: "swaps red and green, blue untouched \u00b7 not yet tested against a real IR/UV photo",
    m: [0,100,0, 100,0,0, 0,0,100] },
  { n: "Cyclic rotation", s: "Aerochrome-like \u00b7 magenta foliage, teal sky",
    m: [0,0,100, 100,0,0, 0,100,0] },
  { n: "Cyclic + IR sub", s: "deeper reds, darker overall",
    m: [0,0,100, 100,0,-30, 0,100,-30] },
  /* The other of the two possible 3-channel rotations \u2014 same idea as
     Cyclic rotation, opposite direction (R\u2190G, G\u2190B, B\u2190R instead of
     R\u2190B, G\u2190R, B\u2190G). Expected to skew toward green/cyan foliage rather
     than magenta, but that is a prediction, not a measurement \u2014 untested
     against a real photo, so the subtitle doesn't claim a specific look. */
  { n: "Reverse cyclic rotation", s: "opposite rotation direction from Cyclic rotation \u00b7 not yet tested against a real IR/UV photo",
    m: [0,100,0, 0,0,100, 100,0,0], hidden: true },   // hidden for now: remove  hidden: true  to show it again, everywhere
  /* Plain green/blue channel swap. Unlike the others here it is not an
     infrared transform at all — it works on ordinary visible-light frames
     too — but it belongs next to them because it is reached the same way,
     by swapping two channels. Kept name-only and un-attributed on purpose:
     "Lomo Purple" below is the actual attributed recipe built from this
     same swap, and the two shouldn't be conflated under one button. */
  { n: "B-G swap", s: "swaps green and blue, red untouched \u00b7 works on visible light too",
    m: [100,0,0, 0,0,100, 0,100,0] },
  /* Fedia's real filter stack (Yellow + Didymium + Midopt DB830 + GRB3),
     posted a year after the original Lomochrome Purple write-up: same G/B
     swap as above, plus a global ~30\u00b0 hue shift so the sky reads as a more
     natural blue instead of the stock look's teal, and straw tones land
     closer to real life. "Approximately 30\u00b0" is Fedia's own wording, not a
     measured value \u2014 direction (+30 vs -30) is a first guess following
     that note; nudge by eye and correct this comment if it's off. */
  { n: "Lomo Purple", s: "Yellow + Didymium + Midopt DB830 + GRB3 stack (Fedia) \u00b7 B-G swap + ~30\u00b0 hue for a more natural sky",
    m: [100,0,0, 0,0,100, 0,100,0], hue: 30 },

  /* EXPERIMENTAL -- from the separate IR colour-system research project
     (simulate_ir_response.py), not a hand-tuned or previously-tested
     recipe like everything else in this list. Fit against real Wratten 12
     photos (the filter this is meant for) using real USGS vegetation/soil
     reflectance data and a real Canon full-spectrum sensor's measured
     behaviour -- but the raw least-squares fit came out numerically wild
     (one coefficient over -700%), which would look broken applied
     directly. These numbers are a rounded, sane-bounded approximation of
     that fit's actual DIRECTION (R output dominated by subtracting blue,
     G and B outputs dominated by adding blue, G more than B, matching the
     fit's own ~3:2 ratio there) -- not the precise fitted values. Genuinely
     untested against a real photo as an actual image transform; that's
     the whole point of putting it here.  */
  { n: "IR colour research (experimental)", s: "Wratten 12 \u00b7 derived from real reflectance/sensor data, not yet tested as an image \u2014 rough, not tuned",
    m: [30,10,-100, 0,10,100, 0,20,60], hidden: true },   // hidden for now: remove  hidden: true  to show it again, everywhere

  /* ---- Film-stock emulations ----
     Three tiers, and the button labels say which is which. "(approx.)" means
     interpreted from written descriptions; anything else here is derived
     from published measurements and says where from. Separately, the
     "Triple Band Aerochrome" toggle in this same group is Fedia's transform
     for his own triple-bandpass filter — measured from that stack rather
     than from film, which is a different claim again and named accordingly.

     Every colour-infrared stock shares one layer arrangement: sensitised to
     green, red and infrared, printing through yellow, magenta and cyan dyes,
     which lands IR on red, red on green and green on blue. That is the
     Cyclic rotation preset above, and it is why an approximation here is a
     variation on it rather than an unrelated matrix — the stocks differ far
     more in contrast, grain and dye crossover than in which channel goes
     where.

     What an approximation varies is that crossover: how much of each
     neighbouring band bleeds into a layer. More bleed reads as the softer,
     more olive rendering of the older emulsions; less reads as the hard
     magenta separation the later ones are known for. A defensible reading of
     the published descriptions, not a measurement.

     Nothing is left at that tier any more. 8443 was the last one, and its
     measured sensitivities turned up in a NASA report rather than a Kodak
     datasheet — worth remembering if another stock ever needs data: the
     people who USED these films for science published more about them than
     the company that sold them. */
  /* The early aerial stock, and no longer an approximation. Its spectral
     sensitivities turned up in an unexpected place: Pease (1969), NASA
     Interagency Report 146, "Predicting the Relative Dye Layer Densities of
     Color Infrared Transparencies", whose Figure 2 tabulates the fraction of
     each dye-layer's exposure falling in each 50nm waveband for Type 8443,
     behind a minus-blue filter, constructed from Fritz (1967):

         nm        Yellow  Magenta  Cyan
         500-550    .52     .04     .01
         550-600    .48     .13     .03
         600-650            .50     .08
         650-700            .33     .14
         700-750                    .25
         750-800                    .21
         800-850                    .20
         850-900                    .08

     Each column sums to 1.00, which is the check that they are what they
     claim to be. Derived into a matrix the same way as 1443: project the
     layers onto a full-spectrum camera's channels, assign cyan(IR) to red
     out, magenta(R) to green, yellow(G) to blue, then regularise.

     The regularisation is set by CLIPPING, not only by noise. A least-squares
     fit of these layers wants large coefficients with negative cross-terms,
     and those force channels below zero on saturated pixels; the clamp at the
     end of the pipeline then flattens them, which is what made these presets
     look coarse and banded. Measured on a real frame across ridge values:
     at 20 the fit pinned 22-49% of the frame, at 70 nothing pinned but the
     colour washed out to a quarter of its saturation, and at 45 clipping
     falls to 0-7% while the banding drops BELOW that of an untouched frame.
     45 is what is used, for all three stocks.

     The same report independently confirms the layer stagger this tool's
     tone response already models: it states the cyan layer "requires close
     to twice the exposure of the other layers to achieve the same density",
     which is 1.0 stop — exactly what was digitised off the 1443
     characteristic curves. Two documents, two stocks, the same figure.

     The film this replaced has deliberately NOT been given a preset. The
     first colour infrared was Kodacolor Aero Film (Camouflage Detection),
     supplied to Allied forces from 1942, and 8443 superseded it in 1959 as
     "three times as fast as the older product, with improved definition and
     less granularity". Every documented difference there is speed, sharpness
     and grain \u2014 none of which a colour matrix can express, and no spectral
     data for it has surfaced. A preset would therefore be either a copy of
     this one under an older name, or an invention. Its place in the lineage
     is worth recording; a fabricated matrix is not.

     The lineage is easy to garble: the first colour infrared was
     Kodacolor Aero Film (Camouflage Detection), issued to Allied forces from
     1942; Ektachrome Infrared Aero Film 8443 replaced it in 1959; 2443
     followed; and Aerochrome III 1443 came last. They are different
     emulsions, not one film renamed.

     Still an approximation \u2014 no curves for 8443 have turned up \u2014 but the
     direction is documented rather than invented. NASA's 1972 evaluation of
     2443 (Cooper, Bowen & Gausman) records that it "has lower contrast than
     the 8443 film, and allows deeper probing into areas that appear as solid
     black shadows on the 8443 film", which makes 8443 the harder, blockier
     of the two. That paper also measures the cyan layer of 2443 as about
     1.5 stops slower than the yellow and magenta layers \u2014 the same layer
     stagger, in the same direction, as the 1.0 stop digitised off the 1443
     curves for the tone response above. Two groups, two stocks, one effect. */
  /* A note on 8442, which is widely listed as "the original colour infrared
     film" and is not one. Its declassified characteristic curves
     (CIA-RDP78B04770A002400030003-1, 15 July 1965, Kodak Ektachrome Aero
     Film 8442, high altitude reconnaissance, modified ME-4, EI 25) plot
     plain Blue, Green and Red channels sitting almost exactly on top of one
     another \u2014 a neutral-balanced conventional colour reversal stock.
     A colour infrared film is the opposite on both counts: its curves are
     labelled by the DYE each layer forms (Yellow/Magenta/Cyan, not
     Blue/Green/Red), and they are deliberately staggered by up to a stop.
     8442 and 8443 are adjacent type numbers and different films, which is
     almost certainly where the confusion started. Nothing here is built on
     8442; the entry above is 8443, the infrared one. */
  /* ---- Derived from Kodak's published spectral sensitivity curves ----
     Aerochrome III 1443, figure F002_1103AC. This one is NOT an eyeballed
     approximation like the three above: the three layer sensitivity curves
     were digitised off the plot, multiplied by the Wratten 12 the datasheet
     itself specifies (it quotes 500-900nm), and projected onto a typical
     full-spectrum camera's channel responses by least squares. The dye
     assignment then follows from the film being a reversal stock with
     subtractive dyes — exposing a layer removes its dye, and each dye
     controls one output channel, so cyan(IR) drives red out, magenta(R)
     drives green out, yellow(G) drives blue out.

     Two honest caveats. The camera side is a MODEL, not a measurement of
     your body: silicon Bayer responses with the heavy past-700nm leak that
     makes a converted camera see IR at all. And the fit is ill-conditioned,
     because all three camera channels leak infrared almost identically —
     solved without regularisation it demanded channel gains of 5x, which
     would amplify sensor noise into garbage. Regularised until the largest
     gain sits near 1.5, which keeps the film's structure while staying
     usable on a real photograph. */

  /* Decoded from IR_TIFFEN_12.atn, an exported editing action. The file is a binary
     descriptor, not a preset format anyone documents, but it parses: three
     Channel Mixer steps in series, then Levels, Brightness/Contrast, Vibrance,
     Colour Balance and Hue/Saturation.

     Only the mixers can live in a preset here, since this is one 3x3 and they
     are three applied in order \u2014 so they are composed into a single matrix,
     which is exactly equivalent for the swap itself:
        1. rotate            R<-B, G<-R, B<-G
        2. subtract IR bleed  -20% red out of green, -9% out of blue
        3. correct colour    a full 3x3 with strong red/green crossover
     Composing gives the array below. The action's remaining steps are tone
     and saturation work, which the sliders in this tool already do \u2014 as a
     starting point it used Brightness/Contrast +74 contrast, Vibrance +10,
     and two Hue/Saturation bands (one lightness -46, one hue +18 with
     saturation +51 and lightness -44).

     Credited to H.H., who wrote the action; the file it came from was built
     around a Tiffen 12, a deep yellow filter of the same class as the
     Wratten 12 the Kodak datasheets specify. Rows do not sum to 1, so a
     neutral grey shifts slightly \u2014 that is his colour cast, kept rather than
     normalised away, since it is part of what the look is. */
  { n: "H.H. 1978 recipe",
    s: "not a film stock \u00b7 H.H.\u2019s Tiffen 12 action: the three channel mixers, levels, contrast, vibrance, colour balance and two hue ranges",
    m: [48,0,53, 89,7,-17, -35,123,18], recipe: 'hh', hidden: true },

  { n: "EIR base (reference look)", s: "a starting point for RAW false-colour work: contrast, colour and RAW noise reduction \u00b7 tune it with Preset strength",
    m: [100,0,0, 0,100,0, 0,0,100], recipe: 'eir', noCam: true, hidden: true }
];

// 1. Sticky Preview Setup
let floatingPreviewInit = false;
let floatingPreviewReady = false;
function initFloatingPreview() {
  // called from loadFile, which runs once per image — without this guard every
  // new image added another scroll listener, another resize listener and
  // another IntersectionObserver, all doing the same work forever
  if (floatingPreviewReady) return;
  floatingPreviewReady = true;
  if (floatingPreviewInit) return;
  floatingPreviewInit = true;
  const ps = $('previewSticky');
  if (!ps) return;
  let naturalTop = 0, offset = 0, ticking = false;

  /* Native sticky does the pinning wherever it's available (see the CSS).
     The transform path below only runs as a fallback, and no longer toggles
     will-change: promoting and demoting a layer twice per scroll is itself a
     repaint, which is a plausible source of flicker rather than a cure for
     it. */
  const NATIVE_STICKY = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('position', 'sticky');
  function nativePin() { return NATIVE_STICKY && window.innerWidth < 1100; }

  /* Transform-based pinning rather than position:fixed + a spacer.
     The spacer approach caused the flicker: toggling it changed the
     document height, which nudged the scroll position, which re-fired
     this handler — a feedback loop right at the threshold. Hysteresis
     only masked it. A transform is purely visual: it never affects
     layout, so document height is constant and the loop can't exist.
     It's also GPU-composited, so it stays smooth while scrolling. */
  function measure() {
    ps.style.transform = '';
    offset = 0;
    naturalTop = ps.getBoundingClientRect().top + window.scrollY;
    apply();
  }
  function apply() {
    if (nativePin()) {
      // CSS owns the pin; make sure no stale transform is left fighting it
      if (offset !== 0) { offset = 0; ps.style.transform = ''; }
      return;
    }
    if (window.innerWidth >= 1100) {
      if (offset !== 0) { offset = 0; ps.style.transform = ''; ps.classList.remove('floating'); }
      return;
    }
    /* Snap to a whole DEVICE pixel. window.scrollY is fractional during
       momentum scrolling, and a composited layer translated by a fractional
       offset has to be resampled — which softens every edge in it, text
       included, for as long as the offset stays fractional. On a 3x screen,
       rounding to whole CSS pixels isn't enough; it has to be the device
       pixel grid. This is the sharpest single cause of the blur. */
    const dpr = window.devicePixelRatio || 1;
    const want = Math.max(0, Math.round((window.scrollY - naturalTop) * dpr) / dpr);
    if (want === offset) return;
    offset = want;
    ps.style.transform = want ? 'translateY(' + want + 'px)' : '';
    ps.classList.toggle('floating', want > 0);
  }
  requestAnimationFrame(measure);
  window.addEventListener('resize', () => requestAnimationFrame(measure));

  /* rAF-throttled, and scrollY is read INSIDE the callback. That combination
     is already correct and is not a frame behind: a rAF callback runs
     immediately before paint, so the position it reads is the position being
     painted. (An earlier revision of this file applied the transform
     synchronously in the scroll event on the theory that the rAF hop added
     lag. It doesn't, and doing style writes on every scroll tick keeps the
     main thread busy enough that mobile browsers drop to low-resolution
     tile rasterisation to keep up — which looks like the whole page going
     soft while you scroll.) */
  window.addEventListener('scroll', () => {
    // a scroll is proof the gesture was never a hold — drop it rather than
    // letting the 220ms timer fire mid-flick and flash the original
    if (press || holdTimer || holding) { press = null; cancelHoldCompare(); }
    if (nativePin() || ticking) return;   // nothing to do per-frame when CSS owns it
    ticking = true;
    requestAnimationFrame(() => { ticking = false; apply(); });
  }, { passive: true });

  /* Stuck-state shadow, driven by whether the 1px sentinel above the preview
     is still on screen. An observer fires twice per pin/unpin rather than on
     every scroll frame, so the shadow costs nothing to maintain. */
  const sentinel = $('previewStickySpacer');
  if (sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(
      ([e]) => { if (nativePin()) ps.classList.toggle('floating', e.intersectionRatio === 0); },
      { threshold: [0, 1] }
    ).observe(sentinel);
  }
}

// 2. Before & After Slider Setup
function setupCompareOverlay() {
  const po = $('previewOrig');
  po.width = rawCanvas.width;
  po.height = rawCanvas.height;
  po.getContext('2d').drawImage(rawCanvas, 0, 0);
  po.style.display = 'block';
  $('cmpHandle').style.display = 'block';
  $('cmpBar').style.display = 'block';
  /* Centred at 50%, per explicit request — worth knowing this was previously
     changed to start fully on AFTER (100%), because a 50% default meant the
     left half permanently showed the untouched original, which read to more
     than one person as "my edit isn't applying." If that report comes back,
     this is why — the trade-off was made deliberately, just in the other
     direction this time. */
  $('cmpRange').value = 50;
  setComparePos(50);
  refSource = undefined; refreshCompareRef();
}

function setComparePos(pct) {
  pct = Math.max(0, Math.min(100, +pct));
  $('previewOrig').style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
  $('cmpHandle').style.left = pct + '%';
  // This bar doesn't touch render(), which is the only place the custom
  // slider fill gets refreshed for every other control — comparing before
  // and after is a preview-only overlay, not a pipeline change, so it's
  // right that it skips a full re-render. But that also meant its OWN fill
  // never got told to move: the thumb tracked a drag fine (the browser
  // handles that natively regardless of my CSS), while the coloured line
  // behind it stayed frozen at its 50% default forever. Same fix as
  // everywhere else, just needed here specifically too.
  $('cmpRange').style.setProperty('--val', pct);
}
$('cmpRange').addEventListener('input', e => setComparePos(e.target.value));
