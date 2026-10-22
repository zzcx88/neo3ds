// Page-language text picker for the web converter modules (#79): the JS
// counterpart of C# Lang.L — a KO page gets the KO sentence, an EN page EN.
export const L = (lang, ko, en) => (lang === 'ko' ? ko : en);
