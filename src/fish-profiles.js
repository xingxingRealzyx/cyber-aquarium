const angelUpper = [.12,.27,.67,.96,1,.83,.56,.30,.12,0];
const angelLower = [.12,.25,.59,.95,1,.97,.70,.36,.13,0];
const discUpper = [.15,.41,.76,.97,1,.89,.67,.39,.105,0];
const discLower = [.17,.44,.79,.98,1,.91,.72,.48,.13,0];
const discWidth = [.15,.31,.59,.88,1,.94,.78,.48,.17,0];
const deepBack = [.18,.31,.64,.94,1,.87,.58,.32,.10,0];

// Body dimensions are measured from the caudal peduncle to the snout.
// Median-fin front/back lie on that axis (0 = peduncle, 1 = snout).
export const FISH_PROFILES = {
  neon: { length: .63, nose: .31, top: .125, belly: .116, width: .074, tail: .19, spread: .117, fork: .46, eye: .032,
    iris: '#79847d', adipose: true },
  guppy: { length: .63, nose: .32, top: .120, belly: .135, width: .086, tail: .30, spread: .202, fork: -.13, eye: .034,
    noseLift: .035, dorsal: { height: .127, sweep: .125 } },
  angelfish: { length: .71, nose: .34, top: .259, belly: .252, width: .077, tail: .225, spread: .172, fork: -.05, eye: .043,
    upper: angelUpper, lower: angelLower, iris: '#8b4434', pelvicStreamer: .40, beat: 5.8, amplitude: .42,
    dorsal: { front: .70, back: .045, tip: .30, height: .25, sweep: .15 },
    anal: { front: .61, height: .23, sweep: .15 } },
  zebra: { length: .78, nose: .38, top: .104, belly: .108, width: .072, tail: .186, spread: .126, fork: .54, eye: .030,
    dorsal: { front: .47 }, anal: { height: .09 } },
  harlequin: { length: .68, nose: .33, top: .165, belly: .160, width: .084, tail: .203, spread: .146, fork: .52, eye: .035,
    iris: '#998061' },
  discus: { length: .84, nose: .43, top: .336, belly: .321, width: .105, tail: .169, spread: .126, roundTail: true, eye: .044,
    upper: discUpper, lower: discLower, girth: discWidth, noseLift: -.018, eyeStation: .835, iris: '#d84829', irisInnerRing: 7, pairedScale: 1.10,
    pelvicStreamer: .19, beat: 6.7, amplitude: .55, flex: .245, medianStroke: .05,
    dorsal: { front: .82, back: .032, tip: .51, height: .112, sweep: .062, backHeight: .41 },
    anal: { front: .61, back: .037, tip: .40, height: .100, sweep: .076, backHeight: .41 } },
  cardinal: { length: .68, nose: .33, top: .12, belly: .113, width: .067, tail: .171, spread: .102, roundedLobes: true, fork: .56, eye: .032,
    iris: '#83938c', adipose: true, dorsal: { front: .55, back: .34, height: .085 }, beat: 9.1 },
  rummynose: { length: .70, nose: .35, top: .11, belly: .114, width: .070, tail: .21, spread: .16, roundedLobes: true, fork: .68, eye: .033,
    iris: '#ac7a60', adipose: true, dorsal: { front: .53, back: .33, height: .11 },
    anal: { front: .45, back: .09, height: .087 }, beat: 9.4 },
  blackneon: { length: .65, nose: .32, top: .129, belly: .14, width: .071, tail: .173, spread: .118, roundedLobes: true, fork: .49, eye: .034,
    iris: '#bdbc98', upperIris: '#df502b', adipose: true, dorsal: { front: .56, back: .32, height: .094 },
    anal: { front: .49, back: .10, height: .09 } },
  cherrybarb: { length: .69, nose: .35, top: .134, belly: .128, width: .089, tail: .19, spread: .127, roundedLobes: true, fork: .49, eye: .032,
    iris: '#ad805b', dorsal: { front: .63, back: .34, height: .106, sweep: .075 },
    anal: { front: .36, back: .19, height: .080 }, beat: 7.9 },
  tigerbarb: { length: .69, nose: .35, top: .199, belly: .173, width: .096, tail: .185, spread: .15, roundedLobes: true, fork: .61, eye: .035,
    upper: deepBack, iris: '#c79151', dorsal: { front: .65, back: .29, height: .147, sweep: .066 },
    anal: { front: .39, back: .17, height: .10 }, beat: 8.5 },
  galaxy: { length: .54, nose: .26, top: .097, belly: .114, width: .069, tail: .139, spread: .083, roundedLobes: true, fork: .27, eye: .032,
    iris: '#c69854', pairedScale: .79, noseLift: .018, dorsal: { front: .50, back: .23, height: .080 },
    anal: { front: .42, back: .19, height: .084 }, beat: 10.2 },
  blackskirt: { length: .68, nose: .34, top: .193, belly: .215, width: .074, tail: .173, spread: .138, roundedLobes: true, fork: .53, eye: .036,
    upper: deepBack, iris: '#94938c', adipose: true, dorsal: { front: .65, back: .40, height: .161, sweep: .06 },
    anal: { front: .56, back: .075, tip: .22, height: .138, sweep: .095, backHeight: .41 }, beat: 7.4 },
  boesemani: { length: .88, nose: .43, top: .202, belly: .174, width: .102, tail: .23, spread: .174, roundedLobes: true, fork: .48, eye: .037,
    upper: deepBack, iris: '#c69a50', pairedScale: 1.16, beat: 6.9, noseLift: .028,
    firstDorsal: { front: .59, back: .48, tip: .44, height: .091, sweep: .043 },
    dorsal: { front: .45, back: .08, tip: .42, height: .103, sweep: .066, backHeight: .39 },
    anal: { front: .57, back: .075, tip: .30, height: .098, sweep: .068, backHeight: .35 } },
  platy: { length: .62, nose: .30, top: .152, belly: .173, width: .105, tail: .157, spread: .127, roundTail: true, eye: .033,
    iris: '#a78c55', noseLift: .038, dorsal: { front: .60, back: .28, height: .124, sweep: .074 },
    anal: { front: .48, back: .34, height: .071 }, beat: 7.8 },
};
