// ============================================================================
//  LOSE THE MODIFIER  ·  phrases.js — the phrase data (no DOM)
// ----------------------------------------------------------------------------
//  Original data, written for this page from general knowledge of English.
//  The idea ("very tired" = "exhausted") comes from losethevery.com. No list,
//  text or design from that site is in this file.
//
//  RAW holds one entry per line, six fields with "|" between them:
//      family | weak phrase | targets | part of speech | register | example
//  targets: the strong words, best first, ";" between them. The example
//  sentence uses the first target. Families with a modifier in front
//  (very, a bit, kind of, ...) split the weak phrase into mod + base.
//  The "verb" family holds a past-tense verb + adverb ("ran quickly"), so
//  the base is the verb and the mod is what follows. The "wordy" family
//  holds stock phrases: the whole phrase is the mod and the base is empty.
//
//  Exports
//    FAMILIES   [{ id, label, mods, kind }] in picker order
//    REGISTERS  the allowed register tags
//    POS        the allowed part-of-speech tags
//    PHRASES    the parsed entries:
//               { id, order, family, phrase, mod, base, modFirst, targets,
//                 pos, reg, ex, mods, toks, stems, bstems }
//    parse(raw) RAW text -> entries (tests.mjs calls it on RAW)
//
//  grep -n targets
//    "export const FAMILIES"   the families and their modifier strings
//    "export function parse"   the line parser
//    "^very|"  "^verb|"  "^wordy|"  and so on: the entries of one family
// ============================================================================
import { stem } from './matcher.js';

export const FAMILIES = [
  { id: 'very', label: 'very', mods: ['very'], kind: 'mod' },
  { id: 'really', label: 'really', mods: ['really'], kind: 'mod' },
  { id: 'so', label: 'so', mods: ['so'], kind: 'mod' },
  { id: 'extremely', label: 'extremely', mods: ['extremely'], kind: 'mod' },
  { id: 'incredibly', label: 'incredibly', mods: ['incredibly'], kind: 'mod' },
  { id: 'super', label: 'super', mods: ['super'], kind: 'mod' },
  { id: 'totally', label: 'totally', mods: ['totally'], kind: 'mod' },
  { id: 'quite', label: 'quite', mods: ['quite'], kind: 'mod' },
  { id: 'pretty', label: 'pretty', mods: ['pretty'], kind: 'mod' },
  { id: 'highly', label: 'highly', mods: ['highly'], kind: 'mod' },
  { id: 'rather', label: 'rather', mods: ['rather'], kind: 'mod' },
  { id: 'abit', label: 'a bit', mods: ['a bit', 'a little'], kind: 'mod' },
  { id: 'kindof', label: 'kind of', mods: ['kind of', 'sort of'], kind: 'mod' },
  { id: 'alot', label: 'a lot of', mods: ['a lot of', 'lots of'], kind: 'mod' },
  { id: 'verb', label: 'verb + adverb', mods: [], kind: 'verb' },
  { id: 'wordy', label: 'wordy phrases', mods: [], kind: 'wordy' },
];
export const REGISTERS = ['neutral', 'formal', 'casual', 'vivid', 'literary'];
export const POS = ['adj', 'adv', 'verb', 'noun', 'conj', 'prep', 'phrase'];
const FAM = new Map(FAMILIES.map(f => [f.id, f]));

export function parse(raw) {
  const out = [];
  raw.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    const [family, phrase, tg, pos, reg, ex] = line.split('|');
    const f = FAM.get(family) || { mods: [], kind: 'wordy' };
    let mod = phrase, base = '', modFirst = true;
    if (f.kind === 'mod') {
      const m = f.mods.find(m => phrase.startsWith(m + ' ')) || '';
      mod = m; base = phrase.slice(m.length).trim();
    } else if (f.kind === 'verb') {
      const i = phrase.indexOf(' ');
      base = phrase.slice(0, i); mod = phrase.slice(i + 1); modFirst = false;
    }
    const toks = phrase.split(' ');
    out.push({
      id: out.length, order: out.length, family, phrase, mod, base, modFirst,
      targets: (tg || '').split(';').map(s => s.trim()).filter(Boolean), pos, reg, ex,
      mods: f.mods, toks, stems: toks.map(stem), bstems: base ? base.split(' ').map(stem) : toks.map(stem),
    });
  });
  return out;
}

export const RAW = `
very|very able|capable;competent;skilled|adj|neutral|She is a capable manager who keeps every project on schedule.
very|very abrupt|sudden;curt|adj|neutral|The sudden stop threw us forward in our seats.
very|very accurate|precise;exact;meticulous|adj|neutral|The new scale gives a precise reading down to a tenth of a gram.
very|very active|energetic;dynamic;vigorous|adj|neutral|The energetic puppy chased the ball around the yard for an hour.
very|very afraid|terrified;petrified;fearful|adj|neutral|The child was terrified of the thunder rolling over the hills.
very|very aggressive|hostile;belligerent;ferocious|adj|neutral|The hostile crowd shouted at the referee after the final whistle.
very|very alert|vigilant;watchful;attentive|adj|neutral|The vigilant guard noticed the open window at once.
very|very alike|identical;indistinguishable|adj|neutral|The twins wore identical coats, so nobody could tell them apart.
very|very alone|isolated;solitary;forlorn|adj|neutral|After the move he felt isolated in a town where he knew nobody.
very|very amazing|astounding;astonishing;breathtaking|adj|vivid|The view from the summit was astounding in the morning light.
very|very ambitious|driven;aspiring;zealous|adj|neutral|She is driven and wants to run her own firm by thirty.
very|very angrily|furiously;irately|adv|neutral|She furiously tore up the letter and threw it in the fire.
very|very angry|furious;livid;enraged;irate|adj|vivid|Dad was furious when he saw the dent in his new car.
very|very annoyed|exasperated;irritated;infuriated|adj|neutral|The teacher grew exasperated as the class kept talking.
very|very annoying|exasperating;infuriating;maddening|adj|neutral|The dripping tap was exasperating at three in the morning.
very|very anxious|distraught;apprehensive;frantic|adj|neutral|She was distraught when her son did not come home by midnight.
very|very apparent|glaring;obvious;conspicuous|adj|neutral|There was a glaring error on the first page of the report.
very|very appealing|irresistible;enticing;alluring|adj|neutral|The smell of fresh bread made the bakery irresistible.
very|very appreciative|grateful;thankful|adj|neutral|We are grateful for every volunteer who helped clean the park.
very|very ashamed|mortified;humiliated|adj|neutral|He was mortified when his phone rang during the funeral.
very|very attractive|stunning;gorgeous;striking|adj|vivid|She looked stunning in the green dress at the wedding.
very|very awful|dreadful;atrocious;abysmal|adj|neutral|The dreadful weather kept everyone indoors all weekend.
very|very awkward|excruciating;cringeworthy|adj|casual|The silence after his joke was excruciating for everyone at the table.
very|very bad|terrible;awful;atrocious;dreadful|adj|neutral|The service at that hotel was terrible from check-in to checkout.
very|very badly|terribly;dreadfully;atrociously|adv|neutral|The play went terribly on opening night, and the critics noticed.
very|very basic|rudimentary;elementary|adj|formal|The cabin had only rudimentary plumbing and a wood stove.
very|very beautiful|gorgeous;stunning;exquisite|adj|vivid|The garden looks gorgeous when the roses are in bloom.
very|very beloved|cherished;treasured|adj|neutral|The old quilt is a cherished gift from my grandmother.
very|very big|enormous;huge;massive;immense|adj|neutral|An enormous tree had fallen across the road after the storm.
very|very bitter|acrid;resentful|adj|neutral|An acrid smoke rose from the burning tires.
very|very black|jet-black;pitch-black|adj|vivid|The cat had a jet-black coat and bright yellow eyes.
very|very bland|insipid;tasteless|adj|neutral|The hospital soup was insipid and badly needed salt.
very|very blue|azure;cobalt|adj|literary|The azure sea stretched out beyond the white cliffs.
very|very blunt|brusque;curt|adj|neutral|Her brusque reply ended the conversation before it had started.
very|very bored|weary;jaded|adj|neutral|She was weary of the same arguments every night.
very|very boring|tedious;dull;monotonous|adj|neutral|Filling in the tax form was tedious work.
very|very bossy|domineering;overbearing|adj|neutral|Her domineering boss checked every email she sent.
very|very brave|courageous;fearless;heroic;intrepid|adj|neutral|The courageous firefighter went back in for the last child.
very|very brief|fleeting;momentary|adj|neutral|We caught a fleeting glimpse of the deer before it ran.
very|very bright|dazzling;brilliant;radiant|adj|vivid|The dazzling sun on the snow made us squint.
very|very brilliant|ingenious;dazzling|adj|neutral|The engineer found an ingenious way to save water.
very|very broad|sweeping;expansive|adj|neutral|The new law makes sweeping changes to the tax code.
very|very broken|shattered;wrecked|adj|vivid|The vase lay shattered on the kitchen floor.
very|very bumpy|jarring;rough|adj|neutral|The jarring ride down the dirt road shook loose a hubcap.
very|very busy|swamped;hectic;overloaded|adj|casual|I am swamped with orders this week, so lunch must wait.
very|very calm|serene;tranquil;placid|adj|neutral|The lake was serene at dawn, without a single ripple.
very|very capable|accomplished;proficient|adj|neutral|She is an accomplished pilot with ten thousand hours in the air.
very|very careful|cautious;meticulous;scrupulous|adj|neutral|Be cautious on the icy steps outside the library.
very|very carefully|meticulously;painstakingly;cautiously|adv|neutral|She meticulously labeled each jar in the pantry.
very|very careless|reckless;negligent|adj|neutral|The reckless driver ran two red lights in a row.
very|very casual|relaxed;laid-back|adj|casual|The office has a relaxed dress code on Fridays.
very|very certain|positive;convinced;sure|adj|neutral|I am positive that I locked the front door.
very|very cheap|inexpensive;stingy;miserly|adj|neutral|We found an inexpensive hotel near the station.
very|very cheerful|jovial;buoyant;exuberant|adj|neutral|The jovial host greeted every guest by name.
very|very childish|infantile;juvenile|adj|neutral|His infantile tantrum over the lost game embarrassed the whole team.
very|very clean|spotless;immaculate;pristine|adj|neutral|The kitchen was spotless after the deep clean.
very|very clear|obvious;transparent;lucid|adj|neutral|It was obvious from her smile that she had won.
very|very clearly|plainly;distinctly;obviously|adv|neutral|I could plainly hear the radio through the wall.
very|very clever|brilliant;ingenious;shrewd|adj|neutral|That was a brilliant solution to a hard puzzle.
very|very clingy|needy;possessive|adj|casual|The needy puppy whined whenever we left the room.
very|very close|intimate;nearby;imminent|adj|neutral|They are intimate friends who share every secret.
very|very cloudy|overcast;murky|adj|neutral|The sky was overcast all day, and the lamps came on early.
very|very clumsy|bumbling;ungainly|adj|neutral|The bumbling waiter knocked over three glasses in one night.
very|very cold|freezing;frigid;icy;frosty|adj|neutral|It was freezing on the platform while we waited for the train.
very|very colorful|vibrant;vivid;kaleidoscopic|adj|vivid|The market was full of vibrant fabrics and painted pots.
very|very comfortable|cozy;snug|adj|casual|The cabin was cozy with a fire in the grate.
very|very common|ubiquitous;widespread;prevalent|adj|formal|Smartphones are now ubiquitous in every classroom across the country.
very|very competitive|cutthroat;ruthless|adj|vivid|Advertising is a cutthroat business with few second chances.
very|very complete|comprehensive;exhaustive;thorough|adj|formal|The guide gives a comprehensive list of every trail in the park.
very|very complex|intricate;convoluted|adj|neutral|The watch has an intricate movement of over two hundred parts.
very|very complicated|convoluted;intricate|adj|neutral|The plot of the film was so convoluted that I lost track.
very|very concerned|worried;troubled|adj|neutral|Her parents were worried about her long drive at night.
very|very confident|assured;self-assured|adj|neutral|He gave an assured performance in his first lead role.
very|very confused|bewildered;baffled;perplexed|adj|neutral|The tourists looked bewildered by the subway map.
very|very confusing|baffling;bewildering|adj|neutral|The new parking rules are baffling to most drivers.
very|very conservative|traditional;orthodox|adj|neutral|The family keeps traditional customs at every holiday.
very|very cool|chilly;nippy|adj|neutral|A chilly breeze came off the water after sunset.
very|very correct|accurate;exact|adj|neutral|Her guess about the final score was accurate to the point.
very|very cozy|snug;homely|adj|casual|The snug little room had a window seat and a lamp.
very|very crazy|insane;deranged|adj|casual|It was insane to drive that fast in the snow.
very|very creative|inventive;imaginative;innovative|adj|neutral|The inventive chef turns leftovers into new dishes.
very|very critical|crucial;vital;essential|adj|neutral|Clean water is crucial for the health of the village.
very|very crowded|packed;teeming;jammed|adj|casual|The train was packed, and we stood the whole way.
very|very cruel|vicious;merciless;heartless|adj|neutral|The vicious dog bit two people before it was caught.
very|very curious|inquisitive;nosy|adj|neutral|The inquisitive boy asked how the elevator worked.
very|very cute|adorable;precious|adj|casual|The kittens were adorable as they slept in a pile.
very|very damaged|ruined;wrecked;devastated|adj|neutral|The flood left the ground floor of the old house ruined.
very|very damp|soggy;sodden|adj|neutral|My shoes were soggy after the walk through the field.
very|very dangerous|perilous;hazardous;treacherous|adj|neutral|The climb along the cliff edge was perilous in the wind.
very|very dark|black;pitch-black;inky;murky|adj|neutral|The cellar was black except for the glow of the boiler.
very|very dear|precious;beloved|adj|neutral|These old letters from my grandfather are precious to me.
very|very deep|profound;bottomless;abysmal|adj|neutral|Her loss left a profound sadness in the house.
very|very delicate|fragile;dainty|adj|neutral|The fragile glass ornaments were wrapped in tissue.
very|very delicious|scrumptious;delectable;mouthwatering|adj|casual|The pie was scrumptious, and nobody left a crumb.
very|very detailed|meticulous;thorough;intricate|adj|neutral|She keeps meticulous notes on every experiment she runs in the lab.
very|very determined|resolute;steadfast;relentless|adj|formal|The resolute coach refused to give up on the team.
very|very different|distinct;dissimilar;disparate|adj|neutral|The two cities have distinct styles of food.
very|very difficult|arduous;grueling;formidable|adj|formal|The climb was arduous, and we rested every hour.
very|very dirty|filthy;grimy;squalid|adj|neutral|His boots were filthy after a day on the farm.
very|very disappointed|crestfallen;dismayed|adj|literary|He was crestfallen when his name was not on the list.
very|very distant|remote;faraway|adj|neutral|The village is remote, two days by road from the capital.
very|very disturbing|harrowing;unsettling|adj|neutral|The documentary gave a harrowing account of the war.
very|very dry|arid;parched|adj|neutral|Few plants live in the arid land west of the hills.
very|very dull|tedious;monotonous;lifeless|adj|neutral|The lecture was tedious, and half the room fell asleep.
very|very dumb|idiotic;foolish;asinine|adj|casual|It was an idiotic plan to drive through the flood.
very|very eager|keen;avid;zealous|adj|neutral|The keen students arrived an hour before the lab opened.
very|very early|premature;untimely|adj|neutral|The premature celebration ended when the other team scored in the last minute.
very|very easily|effortlessly;readily|adv|neutral|She effortlessly swam the length of the pool underwater.
very|very easy|effortless;simple;straightforward|adj|neutral|She made the jump from the high board look effortless.
very|very educated|learned;erudite|adj|formal|The learned judge quoted three old cases from memory.
very|very effective|potent;powerful|adj|neutral|This is a potent medicine, so take only one tablet.
very|very efficient|streamlined;productive|adj|neutral|The streamlined process cut the wait from weeks to days.
very|very elegant|exquisite;refined;graceful|adj|neutral|The hall was decorated with exquisite silk banners.
very|very embarrassed|mortified;humiliated|adj|neutral|I was mortified to find spinach in my teeth after the talk.
very|very emotional|overwrought;passionate;sentimental|adj|neutral|She was too overwrought to speak at the service.
very|very empty|deserted;vacant;desolate;barren|adj|neutral|The streets were deserted at four in the morning.
very|very energetic|vivacious;dynamic;tireless|adj|neutral|The vivacious host kept the party going until midnight.
very|very enjoyable|delightful;pleasurable|adj|neutral|We had a delightful afternoon at the lake.
very|very enormous|colossal;gigantic;mammoth|adj|vivid|A colossal statue stood at the entrance to the harbor.
very|very envious|jealous;covetous|adj|neutral|He was jealous of his brother's new bike.
very|very evil|wicked;villainous;malevolent|adj|neutral|The wicked queen sent the huntsman into the forest.
very|very exact|precise;meticulous|adj|neutral|We need precise measurements before we cut the glass.
very|very excited|thrilled;ecstatic;elated|adj|neutral|The kids were thrilled when the snow day was announced.
very|very exciting|thrilling;exhilarating;electrifying|adj|vivid|The last lap of the race was thrilling to watch.
very|very exhausted|spent;depleted|adj|casual|After the marathon he was spent and lay down on the grass.
very|very expensive|costly;exorbitant;extravagant;pricey|adj|neutral|Fixing the roof turned out to be costly.
very|very experienced|seasoned;veteran;expert|adj|neutral|A seasoned guide led us across the glacier.
very|very faint|imperceptible;feeble|adj|neutral|The change in pitch was almost imperceptible to the untrained ear.
very|very fair|impartial;equitable;just|adj|formal|The judge was impartial in her handling of the case.
very|very faithful|devoted;loyal;steadfast|adj|neutral|The devoted dog waited at the station every evening.
very|very famished|ravenous|adj|vivid|The ravenous wolves circled the camp as the fire burned low.
very|very famous|renowned;celebrated;illustrious|adj|neutral|The renowned violinist played to a full hall.
very|very fancy|lavish;luxurious;ornate|adj|neutral|They threw a lavish party with a band and fireworks.
very|very far|distant;remote|adj|neutral|We heard distant thunder rolling over the mountains to the north.
very|very fast|swift;rapid;quick;speedy|adj|neutral|The swift current carried the canoe downstream past the old mill.
very|very fast-paced|frenetic;hectic;breakneck|adj|vivid|The frenetic pace of the kitchen wore out new cooks.
very|very fat|obese;corpulent|adj|formal|The vet said the cat was obese and needed a diet.
very|very fearful|terrified;timid|adj|neutral|The terrified horse refused to cross the bridge.
very|very feeble|frail;decrepit|adj|neutral|The frail old man needed help with the stairs.
very|very fierce|ferocious;savage;feral|adj|vivid|A ferocious wind tore the sails from the mast.
very|very filthy|squalid;foul|adj|neutral|The refugees lived in squalid tents with no running water.
very|very fine|exquisite;excellent|adj|neutral|The lace on the collar was exquisite work.
very|very firm|rigid;unyielding;steadfast|adj|neutral|The mattress was rigid and gave her a sore back.
very|very flat|level;even|adj|neutral|The field was level enough for a cricket pitch.
very|very flexible|supple;pliable;elastic|adj|neutral|The gymnast has a supple spine and strong arms.
very|very focused|intent;absorbed;engrossed|adj|neutral|He was intent on finishing the puzzle before dinner.
very|very fond|devoted;affectionate|adj|neutral|She is devoted to her nephews and sees them every week.
very|very foolish|idiotic;absurd;reckless|adj|neutral|It was idiotic to leave the keys in the car.
very|very formal|ceremonious;stiff|adj|formal|The ceremonious dinner had five courses and place cards.
very|very fragile|brittle;delicate|adj|neutral|The old pages were brittle and cracked when we turned them.
very|very frank|candid;forthright|adj|neutral|The doctor gave a candid account of the risks.
very|very free|unrestricted;unconstrained|adj|formal|Members have unrestricted access to the reading room.
very|very frequent|constant;incessant;continual|adj|neutral|The constant noise from the road kept us awake.
very|very fresh|crisp;pristine|adj|neutral|The crisp apples came straight from the orchard.
very|very friendly|amiable;affable;cordial|adj|neutral|Our amiable neighbor waters the plants when we travel.
very|very frightened|petrified;terrified|adj|neutral|The petrified hiker froze when the bear came into view.
very|very frightening|terrifying;horrifying;chilling|adj|vivid|The terrifying noise came from inside the wall.
very|very full|packed;stuffed;brimming|adj|casual|The stadium was packed for the final, with fans in every aisle.
very|very funny|hilarious;hysterical;uproarious|adj|casual|Her story about the escaped goat at the wedding was hilarious.
very|very generous|lavish;magnanimous;bountiful|adj|neutral|He gave a lavish tip to the waiter.
very|very gentle|tender;soothing|adj|neutral|The nurse spoke in a tender voice to the scared child.
very|very gently|tenderly;softly|adv|neutral|He tenderly lifted the sleeping baby from the car seat.
very|very glad|delighted;overjoyed|adj|neutral|We are delighted that you can come to the wedding.
very|very gloomy|dismal;bleak;somber|adj|neutral|The dismal weather matched our mood after the loss.
very|very glossy|lustrous;gleaming|adj|neutral|The horse had a lustrous chestnut coat after a good brushing.
very|very good|excellent;superb;outstanding;exceptional|adj|neutral|The food at the new cafe is excellent.
very|very gorgeous|breathtaking;ravishing|adj|vivid|The sunset over the bay was breathtaking from the hotel balcony.
very|very graceful|elegant;lithe|adj|neutral|The elegant dancer crossed the stage in three leaps.
very|very grateful|indebted;thankful|adj|formal|I am indebted to my mentor for her advice.
very|very great|terrific;tremendous;magnificent|adj|casual|We had a terrific time at the beach.
very|very greedy|avaricious;voracious;insatiable|adj|formal|The avaricious landlord raised the rent twice in a year.
very|very green|verdant;lush|adj|literary|The verdant valley was full of sheep and streams.
very|very grumpy|surly;cantankerous|adj|neutral|The surly clerk barely looked up from his desk.
very|very guarded|secretive;reticent|adj|neutral|He is secretive about his life before the war.
very|very guilty|culpable;remorseful|adj|formal|The jury found the driver culpable for the crash.
very|very hairy|hirsute;shaggy|adj|formal|The hirsute actor had to shave for the role.
very|very handsome|dashing;striking|adj|neutral|He looked dashing in his dark blue suit.
very|very happily|joyfully;gleefully|adv|neutral|The kids ran joyfully into the waves on the first day of summer.
very|very happy|ecstatic;elated;overjoyed;thrilled|adj|vivid|She was ecstatic when she heard she got the job.
very|very hard|arduous;grueling;rigid|adj|neutral|The arduous climb took six hours, and we rested every hour.
very|very harmful|destructive;toxic;detrimental|adj|neutral|The destructive storm flattened half the orchard in a single night.
very|very harsh|severe;brutal;grueling|adj|neutral|The severe winter killed most of the crop.
very|very healthy|robust;vigorous;thriving|adj|neutral|The robust plant survived the frost without damage.
very|very heavy|leaden;weighty;cumbersome|adj|neutral|His legs felt leaden after the long climb.
very|very helpful|invaluable;indispensable|adj|neutral|Your notes were invaluable when I studied for the test.
very|very high|towering;lofty;soaring|adj|neutral|The towering cliffs rose straight out of the sea.
very|very holy|sacred;sanctified|adj|formal|The old temple stands on sacred ground at the top of the hill.
very|very honest|sincere;candid;forthright|adj|neutral|Thank you for your sincere apology after the meeting yesterday.
very|very honored|privileged;humbled|adj|formal|I am privileged to speak at this ceremony.
very|very hot|scorching;sweltering;blistering;searing|adj|vivid|It was a scorching afternoon, and the tar on the road went soft.
very|very huge|colossal;gargantuan;gigantic|adj|vivid|The ship was colossal next to the fishing boats.
very|very humble|modest;unassuming|adj|neutral|For a famous author, she is modest about her success.
very|very hungry|starving;ravenous;famished|adj|casual|I was starving after the long hike up to the lake.
very|very hurt|wounded;devastated;injured|adj|neutral|She felt wounded by his careless remark at the dinner table.
very|very ill|ailing;sickly;critical|adj|neutral|The ailing king could no longer leave his bed in the tower.
very|very imaginative|inventive;visionary|adj|neutral|Her inventive stories always have a twist at the end.
very|very immature|childish;infantile|adj|neutral|His childish behavior at the meeting annoyed the client.
very|very important|crucial;essential;vital;paramount|adj|neutral|It is crucial that you take the medicine with food.
very|very impressive|remarkable;extraordinary;awe-inspiring|adj|neutral|The young pianist gave a remarkable performance of a very hard piece.
very|very innocent|naive;guileless|adj|neutral|He was naive enough to believe the salesman.
very|very intelligent|brilliant;gifted;brainy|adj|neutral|She is a brilliant scientist who works on new vaccines.
very|very intense|fierce;extreme;acute|adj|neutral|The two teams have a fierce rivalry that goes back a century.
very|very interested|fascinated;captivated;engrossed|adj|neutral|The children were fascinated by the octopus in the tank.
very|very interesting|fascinating;captivating;intriguing|adj|neutral|The museum has a fascinating display on ancient Egypt.
very|very irritated|exasperated;infuriated|adj|neutral|The exasperated driver honked at the cyclist for the third time.
very|very jealous|envious;covetous|adj|neutral|He was envious of his friend who got the job abroad.
very|very joyful|jubilant;exultant|adj|literary|The jubilant fans ran onto the pitch after the final whistle.
very|very keen|avid;enthusiastic;passionate|adj|neutral|He is an avid reader of history books.
very|very kind|compassionate;benevolent;gracious|adj|neutral|The compassionate nurse sat with the patient all night.
very|very large|huge;vast;immense;massive|adj|neutral|A huge crowd gathered in the square to hear the mayor.
very|very late|overdue;tardy|adj|neutral|The library book is three weeks overdue, so I owe a fine.
very|very lazily|idly;listlessly|adv|neutral|He flicked idly through the magazine while he waited.
very|very lazy|indolent;slothful;idle|adj|formal|The indolent cat slept in the sun all afternoon.
very|very light|weightless;feathery;airy|adj|neutral|The tent is almost weightless when it is packed.
very|very likely|probable|adj|formal|The forecast says rain is probable later this evening in the city.
very|very little|tiny;minute;minuscule|adj|neutral|A tiny bird landed on the window ledge.
very|very lively|animated;vivacious;spirited|adj|neutral|The animated debate in the cafe went on past midnight.
very|very lonely|desolate;forlorn;isolated|adj|literary|He felt desolate in the empty house after the funeral.
very|very long|lengthy;extensive;interminable|adj|neutral|The lawyer gave a lengthy speech to the jury.
very|very loose|baggy;slack|adj|casual|The baggy jeans hung off his hips after he lost the weight.
very|very loud|deafening;thunderous;ear-splitting|adj|vivid|The deafening music made it hard to talk.
very|very loved|adored;cherished;beloved|adj|neutral|The adored teacher retired after forty years at the village school.
very|very lovely|delightful;charming|adj|neutral|We had a delightful walk along the river.
very|very loyal|devoted;faithful;steadfast|adj|neutral|He is a devoted friend who never misses my birthday.
very|very lucky|fortunate;blessed|adj|neutral|We were fortunate to find a table on such a busy night.
very|very mad|furious;livid;irate|adj|neutral|When the bus left without him, Theo was furious for the rest of the morning.
very|very many|countless;numerous;innumerable|adj|neutral|Countless stars filled the sky above the desert camp.
very|very massive|colossal;gigantic;enormous|adj|neutral|A colossal wave struck the harbor wall and flooded the market.
very|very mean|cruel;vicious;spiteful|adj|neutral|The cruel remark stayed with her long after the party ended.
very|very meaningful|profound;significant;momentous|adj|neutral|Their talk had a profound effect on his career.
very|very messy|chaotic;cluttered;disheveled|adj|neutral|His desk was chaotic, with cables and coffee cups piled on every report.
very|very mild|gentle;temperate|adj|neutral|A gentle breeze moved through the orchard all afternoon.
very|very modern|cutting-edge;contemporary;state-of-the-art|adj|casual|The lab bought a cutting-edge microscope with the new grant money.
very|very moist|damp;soggy;sodden|adj|neutral|The cellar walls stayed damp even in the middle of summer.
very|very mysterious|enigmatic;cryptic;inscrutable|adj|neutral|The painting has an enigmatic smile at its center.
very|very narrow|cramped;constricted;tight|adj|neutral|We squeezed down a cramped alley between two old warehouses.
very|very naughty|mischievous;unruly|adj|neutral|The mischievous puppy chewed every shoe by the door.
very|very neat|immaculate;pristine;tidy|adj|neutral|Her kitchen was immaculate, with every spoon in its drawer.
very|very necessary|essential;vital;indispensable|adj|neutral|Clean water is essential for a healthy town.
very|very needy|clingy;demanding|adj|casual|The clingy cat followed her from room to room.
very|very nervous|anxious;jittery;apprehensive|adj|neutral|Before the interview, Sam felt anxious and checked his notes again.
very|very new|novel;brand-new;innovative|adj|neutral|The team tried a novel approach to sorting the archive.
very|very nice|kind;delightful;lovely|adj|neutral|The nurse was kind to every patient on the ward.
very|very noisy|deafening;raucous;rowdy|adj|neutral|The engines were deafening as the jet rolled toward the runway.
very|very normal|ordinary;commonplace;mundane|adj|neutral|It was an ordinary Tuesday until the fire alarm went off.
very|very nosy|prying;meddlesome;intrusive|adj|neutral|Prying neighbors watched every car that came up the drive.
very|very numb|frozen;deadened;insensible|adj|neutral|After an hour in the snow, his fingers were frozen.
very|very obedient|docile;compliant;dutiful|adj|neutral|The docile horse stood still for the farrier.
very|very obvious|glaring;blatant;conspicuous|adj|neutral|The report had a glaring error on the first page.
very|very odd|bizarre;peculiar;outlandish|adj|neutral|A bizarre noise came from the attic at midnight.
very|very offensive|outrageous;insulting;obnoxious|adj|neutral|The outrageous comment drew boos from the crowd.
very|very often|frequently;repeatedly;constantly|adv|neutral|The train is frequently late in the winter months.
very|very old|ancient;antique;aged|adj|neutral|The village church stands on an ancient stone foundation.
very|very open|transparent;candid;frank|adj|neutral|The manager was transparent about the budget cuts from the start.
very|very ordinary|mundane;humdrum;commonplace|adj|neutral|She found the job mundane after her years at sea.
very|very organized|methodical;systematic;orderly|adj|neutral|The methodical librarian labeled every shelf by hand.
very|very overweight|obese;corpulent|adj|formal|The vet said the obese cat needed a strict diet.
very|very painful|agonizing;excruciating;searing|adj|neutral|The broken wrist was agonizing until the nurse gave him medicine.
very|very pale|ashen;wan;pallid|adj|literary|His face turned ashen when he read the letter.
very|very passionate|fervent;ardent;zealous|adj|formal|She is a fervent supporter of the local library.
very|very patient|forbearing;tolerant;long-suffering|adj|formal|The forbearing teacher answered the same question ten times.
very|very peaceful|serene;tranquil;placid|adj|neutral|The lake was serene at dawn, with mist over the water.
very|very perfect|flawless;impeccable|adj|neutral|The pianist gave a flawless performance of the sonata.
very|very persuasive|compelling;convincing;cogent|adj|neutral|She gave a compelling case for the new park.
very|very picky|fussy;finicky;choosy|adj|casual|My fussy nephew eats only plain pasta with a little butter.
very|very plain|austere;stark;bare|adj|neutral|The monks lived in austere cells with one bed and a lamp.
very|very playful|frisky;frolicsome;impish|adj|neutral|The frisky lambs ran circles around the field.
very|very pleasant|delightful;charming;agreeable|adj|neutral|We spent a delightful afternoon in the botanical garden.
very|very pleased|delighted;thrilled;elated|adj|neutral|The coach was delighted with the team's progress.
very|very plentiful|abundant;copious;bountiful|adj|neutral|Fish were abundant in the cold northern waters.
very|very polished|refined;sophisticated;suave|adj|neutral|His refined manners impressed the hosts at the embassy dinner.
very|very polite|courteous;gracious;deferential|adj|formal|The courteous clerk held the door for every customer.
very|very poor|destitute;impoverished;penniless|adj|formal|The war left many families destitute and without shelter.
very|very popular|beloved;renowned;acclaimed|adj|neutral|The beloved bakery sells out of bread by nine.
very|very positive|optimistic;upbeat;buoyant|adj|neutral|Despite the setback, she stayed optimistic about the launch.
very|very powerful|mighty;potent;formidable|adj|neutral|A mighty river once carved this deep canyon.
very|very powerless|helpless;impotent|adj|neutral|We felt helpless as the flood rose around the house.
very|very precise|exact;meticulous;accurate|adj|neutral|We need the exact measurements before we cut the glass.
very|very pretty|beautiful;gorgeous;stunning|adj|neutral|The valley looked beautiful under the first snow of the year.
very|very private|secretive;reclusive;guarded|adj|neutral|The secretive author never gave interviews or posed for photos.
very|very probable|likely;certain|adj|neutral|Rain is likely by the evening, so take a coat.
very|very productive|prolific;fruitful;efficient|adj|neutral|The prolific novelist published three books in two years.
very|very prompt|punctual;immediate|adj|neutral|The punctual courier arrived at exactly nine every morning.
very|very protective|defensive;vigilant;watchful|adj|neutral|The mother hen grew defensive when we came near her chicks.
very|very proud|triumphant;elated;exultant|adj|neutral|She gave a triumphant grin as she crossed the finish line.
very|very pure|pristine;unspoiled;untainted|adj|neutral|The spring water was pristine and cold even in August.
very|very quaint|charming;picturesque|adj|neutral|We stayed in a charming inn by the harbor.
very|very quarrelsome|belligerent;combative;argumentative|adj|formal|The belligerent customer shouted at every clerk in the store.
very|very quick|rapid;swift;speedy|adj|neutral|The rapid response of the crew saved the building.
very|very quickly|rapidly;swiftly;hastily|adv|neutral|The fire spread rapidly through the dry grass.
very|very quiet|silent;hushed;soundless|adj|neutral|The library was silent except for the ticking clock.
very|very quietly|silently;noiselessly;softly|adv|neutral|The cat crept silently across the roof toward the pigeons.
very|very radiant|luminous;glowing;resplendent|adj|literary|The bride looked luminous in the evening light.
very|very rainy|torrential;drenching;pouring|adj|neutral|Torrential rain flooded the lower streets by noon.
very|very random|arbitrary;haphazard|adj|neutral|The rules seemed arbitrary to the new staff.
very|very rare|scarce;uncommon;exceptional|adj|neutral|Fresh water was scarce on the island during the dry season.
very|very ready|eager;prepared;poised|adj|neutral|The eager volunteers arrived an hour early to set up tables.
very|very real|genuine;authentic;tangible|adj|neutral|The museum confirmed that the letter was genuine.
very|very recent|fresh;latest|adj|neutral|The fresh footprints showed that someone had just left.
very|very reckless|rash;careless;foolhardy|adj|neutral|The rash decision cost the firm its biggest client.
very|very red|crimson;scarlet;ruby|adj|literary|The maple leaves turned crimson in the second week of October.
very|very regretful|remorseful;rueful;contrite|adj|neutral|The remorseful driver visited the family to apologize.
very|very relaxed|serene;carefree;laid-back|adj|neutral|After the holiday, she felt serene and rested.
very|very relaxing|soothing;restful;calming|adj|neutral|The soothing music helped the baby fall asleep.
very|very reliable|dependable;trustworthy;steadfast|adj|neutral|My old truck is dependable in any weather.
very|very relieved|reassured;comforted|adj|neutral|The good test result left him reassured for the first time in weeks.
very|very religious|devout;pious;observant|adj|formal|Her devout grandmother attended mass every morning before work.
very|very respectful|reverent;deferential|adj|formal|The visitors stood in reverent silence at the memorial.
very|very restless|fidgety;agitated;jittery|adj|neutral|The fidgety boy could not sit through the sermon.
very|very rich|wealthy;affluent;opulent|adj|neutral|A wealthy donor paid for the new hospital wing.
very|very ridiculous|absurd;preposterous;ludicrous|adj|neutral|The idea of a pet giraffe in a flat is absurd.
very|very rigid|inflexible;unyielding;stiff|adj|neutral|The inflexible rules left no room for special cases.
very|very ripe|overripe;mellow|adj|neutral|The overripe bananas were perfect for a loaf of bread.
very|very risky|perilous;hazardous;precarious|adj|formal|The climbers took a perilous route across the ice.
very|very rocky|craggy;rugged;stony|adj|neutral|Goats climbed the craggy slope with ease while we watched.
very|very romantic|amorous;passionate|adj|literary|The amorous couple held hands all through dinner.
very|very rotten|putrid;decayed;rancid|adj|neutral|A putrid smell rose from the abandoned fridge.
very|very rough|coarse;rugged;jagged|adj|neutral|The coarse wool made the sweater itch all day.
very|very round|circular;spherical|adj|neutral|The circular window let light into the stairwell.
very|very rude|insolent;impolite;disrespectful|adj|formal|The insolent reply earned him a week of detention.
very|very ruined|wrecked;devastated;destroyed|adj|neutral|The storm left the pier wrecked and closed for months.
very|very rushed|hasty;hurried;frantic|adj|neutral|The hasty repair failed after a week of heavy rain.
very|very sacred|hallowed;sacrosanct;holy|adj|formal|The old battlefield is hallowed ground for the town.
very|very sad|sorrowful;miserable;heartbroken|adj|neutral|After the dog died, the whole family felt sorrowful for weeks.
very|very safe|secure;protected|adj|neutral|The documents are secure in the bank vault.
very|very salty|briny;brackish|adj|neutral|The briny soup made everyone reach for water.
very|very satisfied|content;gratified;fulfilled|adj|neutral|After the big meal, the guests were content and quiet.
very|very scarce|rare;sparse;meager|adj|neutral|Rare plants grow only on the highest ledges.
very|very scared|terrified;petrified;frightened|adj|neutral|The kitten was terrified of the vacuum cleaner.
very|very scary|terrifying;frightening;chilling|adj|neutral|The terrifying film kept her awake all night.
very|very scattered|strewn;dispersed|adj|neutral|Leaves lay strewn across the courtyard after the gale.
very|very secret|confidential;classified;clandestine|adj|formal|The confidential files stayed in a locked cabinet.
very|very selfish|self-centered;greedy;egotistical|adj|neutral|His self-centered plan ignored the needs of the team.
very|very sensitive|delicate;fragile;touchy|adj|neutral|The delicate instrument needs a steady hand and a clean bench.
very|very serious|grave;solemn;severe|adj|formal|The doctor said the infection was grave and needed treatment now.
very|very severe|harsh;brutal;draconian|adj|neutral|The harsh winter killed most of the young trees.
very|very shabby|dilapidated;tattered;run-down|adj|neutral|They bought a dilapidated farmhouse and rebuilt it by hand.
very|very shallow|superficial;skin-deep|adj|neutral|The article offered only a superficial view of the crisis.
very|very sharp|keen;razor-sharp;honed|adj|neutral|The chef kept a keen edge on every knife.
very|very shiny|gleaming;glossy;dazzling|adj|neutral|A gleaming new bike stood in the shop window.
very|very shocked|stunned;astounded;aghast|adj|neutral|The crowd was stunned by the late goal.
very|very shocking|appalling;outrageous;scandalous|adj|neutral|The report described appalling conditions in the factory.
very|very short|brief;fleeting;curt|adj|neutral|We had a brief meeting before lunch to agree on the plan.
very|very short-tempered|irascible;irritable;testy|adj|formal|The irascible captain shouted at the deckhands over every knot.
very|very shy|timid;bashful;reserved|adj|neutral|The timid child hid behind his mother's coat.
very|very sick|ill;unwell;ailing|adj|neutral|She was too ill to travel to the wedding.
very|very silly|ridiculous;absurd;ludicrous|adj|neutral|He wore a ridiculous hat to the formal dinner.
very|very similar|alike;indistinguishable;akin|adj|neutral|The twins look alike, and their teachers mixed up their names all year.
very|very simple|basic;elementary;effortless|adj|neutral|The recipe uses only basic ingredients from the pantry.
very|very sincere|earnest;heartfelt;genuine|adj|neutral|He gave an earnest apology to the whole team.
very|very skilled|adept;expert;proficient|adj|neutral|She is adept at fixing old radios and record players.
very|very skinny|gaunt;scrawny;emaciated|adj|neutral|After the long illness, his face looked gaunt.
very|very sleepy|drowsy;lethargic|adj|neutral|The warm room made the whole class drowsy after lunch.
very|very slippery|slick;greasy|adj|neutral|The slick road sent two cars into the ditch.
very|very sloppy|slapdash;careless;slovenly|adj|casual|The slapdash paint job peeled within a month.
very|very slow|sluggish;unhurried;leisurely|adj|neutral|Traffic was sluggish on the bridge all evening.
very|very slowly|sluggishly;gradually;leisurely|adv|neutral|The old dog walked sluggishly to its bowl.
very|very small|tiny;minuscule;minute|adj|neutral|A tiny bird nested in the gutter above the door.
very|very smart|brilliant;intelligent;clever|adj|neutral|The brilliant student solved the puzzle in minutes.
very|very smelly|pungent;foul;rank|adj|neutral|A pungent odor came from the bin behind the market.
very|very smooth|sleek;silky;glassy|adj|neutral|The sleek hull of the boat cut through the water.
very|very smoothly|seamlessly;effortlessly;fluidly|adv|neutral|The handover went seamlessly between the two teams.
very|very sneaky|devious;sly;cunning|adj|neutral|The devious fox stole eggs while the dog slept.
very|very soft|plush;velvety;downy|adj|neutral|The hotel had plush towels and thick robes.
very|very soon|shortly;imminently;momentarily|adv|neutral|The doctor will see you shortly, so please take a seat.
very|very soothing|calming;tranquil|adj|neutral|The calming sound of rain helped her sleep.
very|very sorry|apologetic;remorseful;contrite|adj|neutral|He was apologetic about the late delivery and offered a refund.
very|very sour|acidic;tart;acrid|adj|neutral|The acidic lemons made her lips pucker at the first bite.
very|very sparkly|glittering;dazzling;scintillating|adj|vivid|A glittering chandelier hung above the stage of the old theater.
very|very special|exceptional;extraordinary;unique|adj|neutral|The museum holds an exceptional collection of old maps.
very|very spicy|fiery;scorching;piquant|adj|vivid|The fiery curry made his eyes water before he finished the bowl.
very|very stable|steady;solid;secure|adj|neutral|Keep the ladder steady while I climb up to the gutter.
very|very steep|precipitous;sheer;vertical|adj|formal|A precipitous path led down to the beach.
very|very stiff|rigid;inflexible|adj|neutral|The new boots were rigid until she wore them in.
very|very still|motionless;stationary;immobile|adj|neutral|The deer stood motionless in the clearing as we passed.
very|very stormy|tempestuous;turbulent|adj|literary|The tempestuous sea kept the fleet in harbor.
very|very straight|direct;linear|adj|neutral|The road ran direct to the coast with no bends.
very|very strange|bizarre;peculiar;uncanny|adj|neutral|A bizarre light hovered over the field for an hour.
very|very stressed|frazzled;overwrought;harried|adj|casual|By Friday the frazzled editor had not slept in days.
very|very strict|stern;rigid;severe|adj|neutral|The stern coach allowed no talk during drills.
very|very strong|mighty;robust;sturdy|adj|neutral|The mighty ox pulled the cart up the hill.
very|very strong-willed|resolute;determined;tenacious|adj|neutral|The resolute mayor refused to close the shelter.
very|very stubborn|obstinate;headstrong;mulish|adj|formal|The obstinate mule would not cross the bridge.
very|very stupid|idiotic;foolish;senseless|adj|casual|Driving without a seatbelt is an idiotic risk.
very|very successful|thriving;prosperous;triumphant|adj|neutral|Her thriving bakery now has three shops across the city.
very|very sudden|abrupt;instantaneous|adj|neutral|The abrupt stop threw us forward in our seats.
very|very suitable|ideal;fitting;apt|adj|neutral|The quiet cabin was ideal for writing the last chapters.
very|very sunny|cloudless;radiant;bright|adj|neutral|A cloudless sky greeted the sailors at dawn.
very|very sure|certain;positive;confident|adj|neutral|I am certain that I locked the front door.
very|very surprised|astonished;amazed;astounded|adj|neutral|She was astonished to see her old teacher at the station.
very|very surprising|astonishing;startling;remarkable|adj|neutral|The results were astonishing, even to the scientists.
very|very suspicious|wary;distrustful;skeptical|adj|neutral|The guard was wary of the man with no badge.
very|very sweet|sugary;cloying;saccharine|adj|neutral|The sugary drink left a sticky film on her teeth.
very|very swollen|bloated;distended|adj|neutral|His ankle was bloated and purple the morning after the fall.
very|very talented|gifted;accomplished;skilled|adj|neutral|The gifted violinist played her first concert at nine.
very|very talkative|chatty;garrulous;loquacious|adj|casual|The chatty barber told us his life story.
very|very tall|towering;lofty;soaring|adj|neutral|Towering pines lined both sides of the trail.
very|very tasteless|bland;insipid|adj|neutral|The hospital soup was bland and cold by the time it arrived.
very|very tasty|delicious;scrumptious;flavorful|adj|neutral|Grandma made a delicious pie for the harvest dinner.
very|very tender|succulent;delicate|adj|neutral|The succulent roast fell apart under the fork.
very|very tense|strained;fraught;taut|adj|neutral|The talks were strained after the first day.
very|very terrible|dreadful;atrocious;horrendous|adj|neutral|The dreadful weather kept the ferries in port.
very|very thankful|grateful;appreciative|adj|neutral|We are grateful for your help with the move.
very|very thick|dense;chunky|adj|neutral|A dense fog rolled in from the bay.
very|very thin|slender;slim;lean|adj|neutral|The dancer had slender arms and a long neck.
very|very thirsty|parched;dehydrated|adj|neutral|After the hike, we were parched and drank every bottle.
very|very thorough|meticulous;exhaustive;rigorous|adj|neutral|The meticulous inspector checked every weld on the bridge twice.
very|very tidy|spotless;immaculate;shipshape|adj|neutral|The spotless kitchen shone under the new lights.
very|very tight|taut;constricting;snug|adj|neutral|He pulled the rope taut between the two posts.
very|very timid|skittish;fearful;mousy|adj|neutral|The skittish horse shied at every shadow on the lane.
very|very tiny|microscopic;minuscule;infinitesimal|adj|neutral|The sample held microscopic organisms that swam across the slide.
very|very tired|exhausted;drained;weary|adj|neutral|After the double shift at the clinic, Mara was too exhausted to cook.
very|very tiring|grueling;exhausting;draining|adj|neutral|The grueling climb to the summit took nine hours.
very|very tough|resilient;rugged;hardy|adj|neutral|The resilient plants survived the long drought on the hillside.
very|very tricky|complicated;intricate;thorny|adj|neutral|The complicated form took an hour to fill in.
very|very true|accurate;undeniable|adj|neutral|Her account of the meeting was accurate in every detail.
very|very trusting|credulous;naive;gullible|adj|formal|The credulous buyer paid for a fake painting.
very|very ugly|hideous;grotesque;repulsive|adj|neutral|The hideous mask scared the children at the fair.
very|very unfair|unjust;biased;inequitable|adj|formal|The unjust law was struck down by the court.
very|very unfriendly|hostile;cold;aloof|adj|neutral|The hostile crowd jeered at the visiting team.
very|very unhappy|miserable;wretched;despondent|adj|neutral|The miserable campers sat in wet tents all weekend.
very|very unimportant|trivial;negligible;insignificant|adj|neutral|The trivial error did not change the result.
very|very unlikely|improbable;remote|adj|neutral|A win for the underdog seemed improbable before kickoff.
very|very unpleasant|disagreeable;obnoxious;nasty|adj|formal|The disagreeable smell came from the drains under the kitchen.
very|very untidy|disheveled;unkempt;slovenly|adj|neutral|He arrived disheveled after a night on the train.
very|very unusual|extraordinary;remarkable;rare|adj|neutral|An extraordinary comet appeared over the city in spring.
very|very upset|distraught;distressed;devastated|adj|neutral|She was distraught when the flight was canceled again.
very|very urgent|pressing;critical;dire|adj|neutral|We have a pressing need for blood donors this week.
very|very useful|invaluable;indispensable;handy|adj|neutral|Her map of the old tunnels proved invaluable to the crew.
very|very vague|nebulous;obscure;ambiguous|adj|formal|The plan stayed nebulous until the final week.
very|very valid|sound;compelling;cogent|adj|formal|She made a sound argument for the new budget.
very|very valuable|precious;priceless;invaluable|adj|neutral|The precious ring had belonged to her great-grandmother.
very|very vast|boundless;immense;limitless|adj|literary|The boundless ocean stretched beyond sight in every direction.
very|very violent|brutal;savage;ferocious|adj|neutral|The brutal storm tore roofs from the houses.
very|very visible|conspicuous;prominent;glaring|adj|formal|The conspicuous red sign stood at the crossroads.
very|very vivid|graphic;lurid;striking|adj|neutral|The graphic photos of the crash shocked the jury.
very|very warm|hot;balmy;toasty|adj|neutral|The car seats were hot after a day in the sun.
very|very wary|cautious;vigilant;guarded|adj|neutral|Be cautious near the cliff edge in the fog.
very|very watery|diluted;thin|adj|neutral|The diluted coffee from the machine tasted like warm water.
very|very weak|feeble;frail;fragile|adj|neutral|His feeble voice barely reached the back of the room.
very|very wealthy|affluent;opulent;loaded|adj|formal|They live in an affluent suburb north of the city.
very|very weary|exhausted;fatigued;spent|adj|neutral|The exhausted hikers fell asleep by the fire.
very|very weird|bizarre;outlandish;eerie|adj|casual|That was a bizarre dream about flying fish.
very|very welcome|cherished;treasured|adj|neutral|Her visits were cherished by the residents of the home.
very|very welcoming|hospitable;cordial;warm|adj|neutral|The hospitable family gave us their best room.
very|very well|thoroughly;superbly;admirably|adv|neutral|She cleaned the oven thoroughly before the inspection.
very|very wet|soaked;drenched;sodden|adj|neutral|We came home soaked after the storm caught us on the pier.
very|very white|snowy;ivory;pristine|adj|literary|Snowy sheets hung on the line in the sun.
very|very wicked|villainous;evil;malicious|adj|literary|The villainous count locked the heroine in the tower.
very|very wide|vast;expansive;broad|adj|neutral|A vast plain stretched to the mountains on the horizon.
very|very wild|untamed;feral;savage|adj|neutral|An untamed forest covered the northern hills above the river.
very|very willing|eager;keen;enthusiastic|adj|neutral|He was eager to help with the move.
very|very windy|blustery;gusty;tempestuous|adj|neutral|A blustery day sent umbrellas flying down the street.
very|very wise|sage;sagacious;astute|adj|literary|The sage advice of her teacher guided her for years.
very|very wonderful|marvelous;magnificent;sublime|adj|neutral|We had a marvelous week by the lake.
very|very worn|threadbare;tattered;shabby|adj|neutral|He wore a threadbare coat with holes at the elbows.
very|very worried|anxious;distressed;frantic|adj|neutral|Parents grew anxious as the storm cut power to the school.
very|very worthless|useless;futile;valueless|adj|neutral|The old phone charger was useless with the new model.
very|very wrong|mistaken;erroneous;incorrect|adj|neutral|The witness was mistaken about the time of the crash.
very|very yellow|golden;amber;canary|adj|neutral|Golden fields of wheat surrounded the farmhouse in late summer.
very|very young|youthful;juvenile;infant|adj|neutral|The youthful crew had never sailed in open water.
very|very zealous|fanatical;fervent|adj|neutral|The fanatical fans camped outside the stadium for days.
really|really angry|furious;livid;irate|adj|neutral|She was furious when the bank lost her paperwork.
really|really bad|dreadful;awful;atrocious|adj|neutral|The traffic on the bridge was dreadful this morning.
really|really big|enormous;massive;huge|adj|neutral|An enormous crane swung the steel beam over the street.
really|really boring|tedious;dull;mind-numbing|adj|neutral|Filling in the tax forms was tedious work.
really|really clean|spotless;immaculate|adj|neutral|The hotel bathroom was spotless when we arrived.
really|really cold|freezing;frigid;icy|adj|neutral|The lake was freezing even in late July.
really|really dirty|filthy;grimy;squalid|adj|neutral|The boots were filthy after the hike through the bog.
really|really dislike|loathe;detest;despise|verb|neutral|I loathe the sound of a leaf blower at dawn.
really|really easy|effortless;simple|adj|neutral|Her backhand looked effortless after years of practice.
really|really fast|rapid;swift;breakneck|adj|neutral|The company grew at a rapid pace after the launch.
really|really funny|hilarious;hysterical|adj|neutral|The best man gave a hilarious speech at the wedding.
really|really good|excellent;superb;outstanding|adj|neutral|The bakery on the corner makes excellent sourdough.
really|really happy|overjoyed;thrilled;elated|adj|neutral|They were overjoyed to hear the surgery had gone well.
really|really hard|grueling;arduous;demanding|adj|neutral|The final climb to the summit was grueling.
really|really hot|scorching;sweltering;blistering|adj|vivid|The scorching sun cracked the clay in the field.
really|really hungry|ravenous;starving|adj|neutral|The kids came home from practice ravenous and loud.
really|really hurt|wounded;crushed|adj|vivid|She felt wounded when her oldest friend skipped the wedding.
really|really important|crucial;vital;essential|adj|neutral|Clean water is crucial for the health of the village.
really|really interesting|fascinating;riveting;compelling|adj|neutral|The museum had a fascinating display on early clocks.
really|really like|adore;relish;cherish|verb|neutral|My grandmother would adore this garden in the spring.
really|really look|scrutinize;study;inspect|verb|neutral|The editor will scrutinize every figure in the report.
really|really loud|deafening;thunderous;ear-splitting|adj|vivid|The fireworks finale was deafening from the front row.
really|really need|require;depend on|verb|formal|The plants require full sun and good drainage.
really|really new|brand-new;pristine|adj|casual|He showed up in a brand-new car with paper mats.
really|really old|ancient;antique|adj|neutral|An ancient oak shades the whole churchyard behind the chapel.
really|really poor|destitute;impoverished;penniless|adj|formal|The long flood left many farming families destitute by winter.
really|really pretty|gorgeous;stunning;lovely|adj|neutral|The view from the ridge was gorgeous at sunset.
really|really quiet|silent;hushed|adj|neutral|The library was silent except for the ticking clock.
really|really rich|wealthy;affluent;loaded|adj|neutral|A wealthy donor paid for the new library wing.
really|really sad|heartbroken;devastated;miserable|adj|neutral|He was heartbroken when the old dog finally passed away.
really|really scared|terrified;petrified|adj|neutral|The cat was terrified of the new vacuum cleaner.
really|really slow|sluggish;glacial|adj|neutral|The website felt sluggish during the holiday sale.
really|really small|minuscule;tiny;minute|adj|neutral|The label was printed in minuscule letters on the back.
really|really smart|brilliant;gifted|adj|neutral|She is a brilliant engineer with an eye for detail.
really|really stupid|idiotic;senseless;asinine|adj|casual|Leaving the stove on all day was an idiotic mistake.
really|really sure|certain;positive;convinced|adj|neutral|I am certain I locked the door before we left.
really|really tired|exhausted;drained;spent|adj|neutral|After the overnight flight we were too exhausted to unpack.
really|really try|strive;endeavor|verb|formal|We strive to answer every email within a day.
really|really ugly|hideous;grotesque|adj|neutral|The new parking garage is a hideous concrete block.
really|really want|crave;yearn;covet|verb|neutral|After a week of camping I crave a hot shower.
so|so angry|enraged;incensed;seething|adj|neutral|The fans were enraged by the late penalty call.
so|so annoying|infuriating;maddening;exasperating|adj|neutral|The dripping tap was infuriating at three in the morning.
so|so beautiful|exquisite;breathtaking;radiant|adj|neutral|The lace on the old dress was exquisite.
so|so bored|restless;listless|adj|neutral|The restless students watched the clock during the lecture.
so|so bright|dazzling;brilliant;glaring|adj|vivid|The snowfield was dazzling under the noon sun.
so|so busy|swamped;overloaded;frantic|adj|casual|The help desk is swamped every Monday morning.
so|so calm|serene;tranquil;placid|adj|neutral|The bay was serene at dawn before the boats came out.
so|so confused|bewildered;baffled;perplexed|adj|neutral|The tourists looked bewildered by the subway map.
so|so cute|adorable;endearing|adj|casual|The puppy had an adorable habit of tilting its head.
so|so dark|pitch-black;murky;inky|adj|vivid|The cellar was pitch-black once the bulb died.
so|so different|distinct;dissimilar|adj|neutral|The twins have distinct tastes in music, food and friends.
so|so dry|arid;parched;bone-dry|adj|formal|The arid plain gets rain only twice a year.
so|so embarrassed|mortified;humiliated|adj|neutral|He was mortified when his phone rang during the vows.
so|so excited|thrilled;eager;exhilarated|adj|neutral|The children were thrilled to see snow for the first time.
so|so full|stuffed;sated;bursting|adj|casual|After the long holiday dinner everyone felt stuffed and sleepy.
so|so grateful|thankful;indebted;appreciative|adj|neutral|I am thankful for every neighbor who helped us move.
so|so happy|elated;ecstatic;jubilant|adj|neutral|She was elated when the acceptance letter arrived.
so|so jealous|envious;resentful|adj|neutral|She was envious of her brother's new bicycle.
so|so kind|generous;gracious;compassionate|adj|neutral|A generous stranger paid for our coffee and walked away smiling.
so|so lucky|fortunate;blessed|adj|neutral|We were fortunate to find a seat on the last train.
so|so many|countless;numerous;myriad|adj|neutral|There are countless stars visible from the desert.
so|so mean|cruel;spiteful;nasty|adj|neutral|The cruel comment stayed with her for years.
so|so much|abundant;plenty|adj|neutral|The orchard gave an abundant harvest this year.
so|so nervous|anxious;jittery;on edge|adj|neutral|He was anxious before his first day at the new job.
so|so proud|triumphant;exultant|adj|neutral|The team looked triumphant on the podium with their medals.
so|so sad|sorrowful;crestfallen;despondent|adj|literary|The widow wore a sorrowful look at the gate.
so|so scared|frightened;panicked;aghast|adj|neutral|The frightened horse bolted across the pasture when thunder cracked.
so|so simple|elementary;straightforward|adj|neutral|The fix was elementary once we found the loose wire.
so|so sorry|remorseful;contrite;apologetic|adj|formal|The driver was remorseful and paid for the damage.
so|so surprised|astonished;stunned;amazed|adj|neutral|We were astonished at how quickly the house sold.
so|so thirsty|parched;dehydrated|adj|neutral|We were parched after the long walk across the dunes.
so|so tired|weary;worn out;fatigued|adj|neutral|The weary hikers dropped their packs by the fire.
so|so weird|bizarre;peculiar;outlandish|adj|neutral|We heard a bizarre noise coming from the attic.
so|so wet|soaked;drenched;sodden|adj|neutral|We came home soaked after the storm broke.
extremely|extremely afraid|petrified;terror-stricken|adj|neutral|She was petrified of the dark as a child.
extremely|extremely angry|irate;apoplectic;livid|adj|formal|An irate customer demanded to see the manager.
extremely|extremely bad|catastrophic;disastrous|adj|neutral|The drought had catastrophic effects on the harvest.
extremely|extremely beautiful|ravishing;stunning;sublime|adj|literary|The bride looked ravishing in her mother's gown.
extremely|extremely big|colossal;immense;gigantic|adj|neutral|A colossal iceberg drifted into the shipping lane.
extremely|extremely boring|soporific;stultifying|adj|formal|The soporific lecture put half the room to sleep.
extremely|extremely careful|meticulous;scrupulous;painstaking|adj|neutral|The restorer was meticulous with every brushstroke on the old fresco.
extremely|extremely clever|ingenious;brilliant|adj|neutral|The old lock had an ingenious hidden latch under the brass plate.
extremely|extremely cold|glacial;arctic;bitter|adj|neutral|A glacial wind swept down from the pass.
extremely|extremely dangerous|perilous;treacherous;lethal|adj|formal|The perilous road hugs the edge of the cliff.
extremely|extremely difficult|formidable;herculean;daunting|adj|formal|Rebuilding the bridge before the spring thaw was a formidable task.
extremely|extremely easy|trivial;effortless|adj|neutral|Resetting the router is a trivial job that takes one minute.
extremely|extremely fast|lightning;blistering;supersonic|adj|vivid|The striker made a lightning run down the wing.
extremely|extremely good|exceptional;superlative;stellar|adj|neutral|Her exceptional work on the bridge design earned her a promotion.
extremely|extremely happy|euphoric;rapturous|adj|neutral|The crowd was euphoric when the final whistle blew.
extremely|extremely hot|searing;torrid;sweltering|adj|vivid|The searing heat kept everyone indoors at noon.
extremely|extremely important|paramount;critical;essential|adj|formal|Passenger safety is paramount on every flight, short or long.
extremely|extremely loud|thunderous;deafening|adj|vivid|The crowd gave a thunderous roar at kickoff.
extremely|extremely painful|excruciating;agonizing|adj|neutral|The broken wrist was excruciating until the cast went on.
extremely|extremely quiet|inaudible;noiseless|adj|neutral|His reply was inaudible over the wind on the ridge.
extremely|extremely rare|scarce;unique;one-of-a-kind|adj|neutral|Fresh water is scarce on the outer islands.
extremely|extremely sad|inconsolable;grief-stricken|adj|neutral|The boy was inconsolable after losing his kite.
extremely|extremely slow|glacial;crawling|adj|neutral|Progress on the building permit has been glacial since March.
extremely|extremely small|microscopic;infinitesimal|adj|formal|The sensor picks up microscopic cracks in the metal.
extremely|extremely strong|mighty;formidable;unyielding|adj|literary|A mighty river once carved this canyon through solid rock.
extremely|extremely surprised|flabbergasted;dumbfounded|adj|casual|He was flabbergasted by the size of the bill.
extremely|extremely tired|depleted;shattered;spent|adj|neutral|After the marathon her energy was completely depleted.
extremely|extremely ugly|repulsive;hideous|adj|neutral|The swamp creature in the film was repulsive.
extremely|extremely unusual|extraordinary;anomalous|adj|neutral|The comet put on an extraordinary show last night.
extremely|extremely weak|frail;feeble;debilitated|adj|neutral|Her grandfather was frail after the long illness.
incredibly|incredibly beautiful|breathtaking;magnificent|adj|vivid|The canyon at dawn was breathtaking in red and gold light.
incredibly|incredibly big|vast;titanic;mammoth|adj|neutral|A vast desert stretched from the road to the far horizon.
incredibly|incredibly boring|monotonous;tedious|adj|neutral|Sorting a year of receipts by date was monotonous work.
incredibly|incredibly brave|heroic;fearless;valiant|adj|neutral|The heroic firefighter carried the child out through the smoke.
incredibly|incredibly delicious|scrumptious;delectable|adj|casual|The scrumptious cherry pie disappeared within minutes of leaving the oven.
incredibly|incredibly detailed|intricate;elaborate|adj|neutral|The quilt had an intricate pattern of stars.
incredibly|incredibly difficult|herculean;insurmountable|adj|formal|Cleaning up after the flood was a herculean job.
incredibly|incredibly fast|meteoric;blinding|adj|vivid|The singer had a meteoric rise to fame.
incredibly|incredibly fresh|crisp;dewy|adj|neutral|The crisp apples from the orchard crunched with every bite.
incredibly|incredibly happy|blissful;euphoric|adj|literary|They spent a blissful week on the island.
incredibly|incredibly hard-working|tireless;industrious|adj|neutral|The tireless volunteers worked through the night to fill sandbags.
incredibly|incredibly helpful|invaluable;indispensable|adj|neutral|Her detailed notes were invaluable to me during the final exam.
incredibly|incredibly important|momentous;pivotal|adj|formal|The treaty was a momentous step toward peace.
incredibly|incredibly interesting|captivating;enthralling|adj|neutral|The guide told a captivating story about the castle.
incredibly|incredibly kind|benevolent;magnanimous|adj|formal|The benevolent landlord forgave the late rent after the flood.
incredibly|incredibly loud|earsplitting;deafening|adj|vivid|An earsplitting alarm went off in the hall.
incredibly|incredibly lucky|charmed;blessed|adj|neutral|She has led a charmed life with few setbacks.
incredibly|incredibly popular|iconic;celebrated|adj|neutral|The iconic diner has stood on this corner since 1950.
incredibly|incredibly rich|opulent;lavish|adj|neutral|The palace had an opulent ballroom of gold and glass.
incredibly|incredibly sad|tragic;harrowing|adj|neutral|The film tells a tragic story of two lost brothers.
incredibly|incredibly small|teeny;minute|adj|casual|The teeny frog could sit comfortably on a fingertip.
incredibly|incredibly smart|genius;prodigious|adj|casual|Her genius idea for the warehouse saved the company millions.
incredibly|incredibly strong|indestructible;herculean|adj|vivid|The old cast iron pan seems indestructible after fifty years.
incredibly|incredibly stupid|moronic;inane|adj|casual|It was a moronic plan from the start.
incredibly|incredibly talented|gifted;virtuosic|adj|neutral|A gifted young pianist played at the opening of the hall.
super|super busy|slammed;swamped|adj|casual|The restaurant was slammed on Friday night with three big parties.
super|super cheap|dirt-cheap;inexpensive|adj|casual|The bus to the airport is dirt-cheap if you buy online.
super|super clean|spotless;gleaming|adj|neutral|The spotless kitchen smelled of lemon and fresh coffee.
super|super cold|frosty;freezing|adj|neutral|The frosty morning left ice on the windshield.
super|super cool|awesome;sensational|adj|casual|The drone show over the harbor was awesome.
super|super cute|adorable;precious|adj|casual|The baby goats were adorable as they hopped around the pen.
super|super easy|foolproof;effortless|adj|casual|The bread recipe is foolproof, even for a nervous beginner.
super|super excited|stoked;pumped;thrilled|adj|casual|We're stoked about the trip to the coast.
super|super expensive|exorbitant;extortionate|adj|formal|The hotel charged an exorbitant fee for parking.
super|super fast|rapid;lightning-fast|adj|neutral|The new charger gives a rapid top-up in minutes.
super|super fun|thrilling;exhilarating|adj|neutral|The roller coaster was thrilling from start to finish.
super|super happy|delighted;overjoyed|adj|neutral|We were delighted with how the photos turned out.
super|super hard|brutal;punishing|adj|casual|The brutal climb to the pass left everyone gasping for air.
super|super hot|blazing;boiling|adj|casual|It was blazing on the beach by noon.
super|super long|endless;interminable|adj|neutral|The endless queue for tickets wrapped twice around the block.
super|super loud|booming;blaring|adj|vivid|A booming voice came over the speakers and silenced the hall.
super|super nice|lovely;charming|adj|neutral|The host was lovely and showed us around.
super|super short|brief;fleeting|adj|neutral|The speech was brief and to the point.
super|super smart|brainy;brilliant|adj|casual|Her brainy cousin fixed the laptop in minutes.
super|super strong|powerful;mighty|adj|neutral|A powerful current pulled the boat off course.
super|super tired|beat;wiped|adj|casual|I am beat after carrying all those boxes up four flights.
super|super weird|freaky;bizarre|adj|casual|There was a freaky glow coming from the pond.
totally|totally agree|concur|verb|formal|I concur with the board, and I will sign the order today.
totally|totally amazing|phenomenal;astounding|adj|casual|The view from the top of the tower was phenomenal at dusk.
totally|totally certain|convinced;sure|adj|neutral|The detective was convinced the butler was lying.
totally|totally confused|lost;befuddled|adj|casual|I was lost halfway through the instructions for the flat-pack desk.
totally|totally covered|blanketed;coated;smothered|adj|vivid|Fresh snow blanketed the valley overnight and closed the pass.
totally|totally crazy|insane;absurd;ludicrous|adj|casual|Driving there and back in one day is insane.
totally|totally dark|pitch-black;lightless|adj|vivid|The tunnel was pitch-black beyond the first bend.
totally|totally destroyed|demolished;obliterated;wrecked|adj|vivid|The winter storm demolished the old pier and half the boardwalk.
totally|totally different|unrelated;dissimilar|adj|neutral|The two crimes turned out to be unrelated.
totally|totally empty|vacant;deserted;bare|adj|neutral|The vacant lot filled with wildflowers in May.
totally|totally exhausted|depleted;wiped out|adj|neutral|By the final lap his reserves were depleted.
totally|totally forget|overlook;neglect|verb|neutral|It is easy to overlook small costs in a budget.
totally|totally free|complimentary;gratis|adj|formal|Guests receive a complimentary breakfast each morning in the lobby cafe.
totally|totally full|packed;crammed;jammed|adj|casual|The stadium was packed for the derby against our old rivals.
totally|totally honest|candid;frank;forthright|adj|neutral|She gave a candid account of her mistakes.
totally|totally ignore|disregard;snub|verb|neutral|Drivers often disregard the speed limit on this stretch of road.
totally|totally new|novel;unprecedented|adj|formal|The team tried a novel approach to the problem.
totally|totally right|correct;spot-on|adj|neutral|Your estimate of the cost was correct to the dollar.
totally|totally silent|soundless;mute|adj|literary|The snowy forest was soundless at midnight, with no wind at all.
totally|totally sure|adamant;certain|adj|neutral|He was adamant that he had paid the bill.
totally|totally useless|futile;worthless|adj|neutral|Shouting at the jammed printer was futile, so I called support.
totally|totally wrong|baseless;unfounded;false|adj|formal|The rumor about the merger turned out to be completely baseless.
quite|quite a few|several;numerous|adj|neutral|Several neighbors came out to watch the eclipse.
quite|quite bad|poor;subpar;mediocre|adj|neutral|The sound quality on the recording was poor.
quite|quite big|sizable;substantial;considerable|adj|neutral|They bought a sizable plot of land by the river.
quite|quite cheap|inexpensive;affordable|adj|neutral|The open market sells inexpensive fruit every Saturday morning.
quite|quite clear|evident;obvious;apparent|adj|neutral|It was evident that the plan would not work.
quite|quite cold|chilly;nippy;brisk|adj|neutral|It was chilly enough for gloves on the walk home.
quite|quite different|distinct;contrasting|adj|neutral|Each dialect has a distinct rhythm and sound.
quite|quite expensive|pricey;costly|adj|casual|The restaurant was pricey but worth the trip.
quite|quite funny|amusing;droll|adj|neutral|The cartoon had an amusing twist at the end.
quite|quite good|decent;solid;respectable|adj|neutral|The hotel served a decent breakfast for the price.
quite|quite hard|challenging;tough|adj|neutral|The Sunday crossword was challenging but fair to the end.
quite|quite nice|pleasant;agreeable|adj|neutral|We had a pleasant stroll through the park.
quite|quite often|frequently;regularly|adv|neutral|The bus is frequently late in heavy rain.
quite|quite old|elderly;aged;dated|adj|neutral|An elderly man fed the pigeons in the square.
quite|quite quiet|subdued;muted|adj|neutral|The office was subdued for weeks after the layoffs.
quite|quite rude|impolite;discourteous|adj|formal|It is impolite to check your phone during dinner.
quite|quite similar|comparable;akin|adj|formal|The two phone models offer comparable battery life and screen quality.
quite|quite small|compact;modest|adj|neutral|The apartment is compact but full of light.
quite|quite strange|odd;curious|adj|neutral|There was an odd smell coming from the fridge.
quite|quite sure|confident;certain|adj|neutral|I am confident the train will leave on time.
quite|quite tired|weary;drowsy|adj|neutral|By evening the weary crew wanted only sleep.
quite|quite warm|balmy;mild|adj|neutral|We ate dinner outside on a balmy evening.
pretty|pretty angry|annoyed;irritated;cross|adj|neutral|She was annoyed that nobody had cleaned the kitchen.
pretty|pretty bad|lousy;shoddy;rough|adj|casual|The movie had a lousy ending that nobody in the theater liked.
pretty|pretty big|hefty;bulky;sizable|adj|casual|The two movers lifted a hefty oak wardrobe up the stairs.
pretty|pretty boring|bland;dull;humdrum|adj|neutral|The soup was bland and badly needed salt and pepper.
pretty|pretty clean|tidy;neat|adj|neutral|The kids kept their room tidy all week.
pretty|pretty cool|impressive;neat;slick|adj|casual|The magician saved his most impressive trick for the very end.
pretty|pretty easy|manageable;painless|adj|neutral|The first week of the course was manageable.
pretty|pretty fast|brisk;speedy;quick|adj|neutral|We set a brisk pace on the trail.
pretty|pretty funny|witty;comical|adj|neutral|His witty reply made the whole room laugh.
pretty|pretty good|solid;fine;creditable|adj|casual|The band gave a solid performance despite the rain.
pretty|pretty happy|content;cheerful|adj|neutral|He seemed content with his small garden and his books.
pretty|pretty hard|tricky;taxing|adj|casual|Parallel parking on a steep hill is tricky for new drivers.
pretty|pretty loud|noisy;boisterous|adj|neutral|The noisy neighbors held a party until two.
pretty|pretty messy|untidy;disheveled;cluttered|adj|neutral|His desk was untidy but he knew where everything was.
pretty|pretty quiet|peaceful;calm;still|adj|neutral|The village is peaceful once the tourists leave.
pretty|pretty sad|gloomy;somber;downcast|adj|neutral|The gloomy weather matched our mood after the loss.
pretty|pretty scary|unnerving;creepy;eerie|adj|neutral|The empty hallway had an unnerving silence after the lights went out.
pretty|pretty slow|leisurely;unhurried|adj|neutral|We took a leisurely drive along the coast.
pretty|pretty small|petite;slight;modest|adj|neutral|The petite dancer leapt across the stage in a single bound.
pretty|pretty smart|sharp;shrewd;bright|adj|casual|She is a sharp negotiator who reads people well.
pretty|pretty sure|confident;fairly certain|adj|neutral|I am confident the meeting starts at ten, not eleven.
pretty|pretty weird|offbeat;odd;quirky|adj|casual|The little cafe has an offbeat charm that the locals love.
highly|highly competitive|cutthroat;fierce|adj|casual|The real estate market in the city is cutthroat right now.
highly|highly critical|scathing;damning|adj|neutral|The critic wrote a scathing review of the play.
highly|highly educated|learned;erudite|adj|formal|The learned professor spoke six languages and read three more.
highly|highly effective|potent;powerful|adj|neutral|The new drug is potent against the virus.
highly|highly emotional|overwrought;fraught|adj|neutral|The overwrought groom forgot his lines halfway through the vows.
highly|highly flammable|combustible;volatile|adj|formal|Keep combustible liquids well away from the furnace and the water heater.
highly|highly important|critical;cardinal|adj|formal|Timing is critical in a rescue at sea, where minutes count.
highly|highly intelligent|brilliant;erudite|adj|neutral|The brilliant student finished the test early and checked every answer.
highly|highly likely|probable;expected|adj|formal|Rain is probable by late afternoon, so bring an umbrella.
highly|highly qualified|accomplished;seasoned|adj|neutral|An accomplished chef with twenty years of experience runs the kitchen.
highly|highly recommended|acclaimed;lauded|adj|formal|The acclaimed novel won three major awards in its first year.
highly|highly respected|esteemed;eminent;revered|adj|formal|An esteemed retired judge led the public inquiry into the collapse.
highly|highly sensitive|delicate;fragile|adj|neutral|The delicate instrument must be kept dry and away from dust.
highly|highly skilled|expert;adept;proficient|adj|neutral|An expert carpenter rebuilt the curved staircase in two weeks.
highly|highly successful|prosperous;thriving|adj|neutral|The prosperous town grew up around the old woollen mill.
highly|highly unlikely|improbable;doubtful|adj|formal|A tie in the final round is improbable.
highly|highly unusual|irregular;anomalous|adj|formal|The bank flagged an irregular payment from an unknown account.
highly|highly visible|prominent;conspicuous|adj|neutral|The tower is a prominent landmark on the skyline.
rather|rather annoying|irksome;tiresome|adj|formal|The constant hum from the neighbor's generator was irksome.
rather|rather bad|unfortunate;regrettable|adj|formal|It was an unfortunate choice of words at a family funeral.
rather|rather boring|uninspired;pedestrian|adj|formal|The speech was competent but uninspired, and the audience drifted off.
rather|rather clever|astute;canny|adj|formal|It was an astute move to sell before the crash.
rather|rather cold|crisp;cool|adj|neutral|A crisp breeze came off the river as the sun went down.
rather|rather difficult|awkward;tricky|adj|neutral|The handover put us in an awkward position.
rather|rather good|commendable;creditable|adj|formal|The rookie gave a commendable performance in his first full game.
rather|rather important|significant;notable|adj|formal|This is a significant change to the rules.
rather|rather large|substantial;ample;sizable|adj|formal|The firm made a substantial profit this year.
rather|rather quickly|briskly;promptly|adv|neutral|She walked briskly to the station with her coat buttoned up.
rather|rather rude|brusque;curt|adj|neutral|The clerk gave a brusque reply and turned away.
rather|rather slowly|gradually;steadily|adv|neutral|The tide rose gradually over the mud flats all afternoon.
rather|rather small|diminutive;modest|adj|formal|The diminutive actor commanded the stage from the moment he entered.
rather|rather strange|curious;peculiar|adj|formal|A curious silence fell over the room when the letter was read.
rather|rather tired|jaded;listless|adj|neutral|The jaded critic had seen too many sequels.
abit|a bit angry|irritated;peeved|adj|neutral|He was irritated by the constant interruptions during his talk.
abit|a bit cold|cool;chilly|adj|neutral|The cool morning air woke us up on the walk to school.
abit|a bit dirty|grubby;smudged|adj|casual|The kids came in from the garden with grubby hands.
abit|a bit drunk|tipsy;merry|adj|casual|After two glasses of wine she was tipsy.
abit|a bit hungry|peckish|adj|casual|I am peckish, so let's grab a snack before the film.
abit|a bit late|tardy;behind|adj|formal|The tardy guests missed the toast but arrived for the cake.
abit|a bit nervous|jittery;edgy|adj|casual|Too much coffee before a long drive makes me jittery.
abit|a bit sad|blue;melancholy|adj|casual|She felt blue after her friends moved away.
abit|a bit scared|uneasy;apprehensive|adj|neutral|The uneasy campers listened to the howls from the dark woods.
abit|a bit sick|queasy;unwell;off-color|adj|neutral|The rough boat ride across the bay left me queasy.
abit|a bit strange|odd;quirky|adj|neutral|There is something odd about the new painting.
abit|a bit tired|drowsy;sleepy|adj|neutral|The drowsy passenger nodded off by the window.
abit|a bit warm|lukewarm;tepid|adj|neutral|The lukewarm tea had sat for an hour.
abit|a bit wet|damp;moist|adj|neutral|The towels were still damp from the pool.
abit|a bit worried|concerned;uneasy|adj|neutral|We were concerned when the call went unanswered.
abit|a little bit|slightly;somewhat|adv|neutral|The jacket is slightly too long in the sleeves.
abit|a little quiet|reserved;shy|adj|neutral|The reserved boy rarely spoke in class but wrote brilliant essays.
abit|a little rude|curt;short|adj|neutral|His curt email upset the team just before the holiday.
abit|a little sad|wistful;pensive|adj|literary|She gave a wistful smile at the old photo.
abit|a little scared|wary;timid|adj|neutral|The wary deer watched us from the trees.
kindof|kind of angry|resentful;irked|adj|neutral|He was resentful about being left out of the plan.
kindof|kind of crazy|zany;madcap|adj|casual|The zany comedy kept the kids laughing for two hours.
kindof|kind of dark|dim;shadowy|adj|neutral|The dim hallway needed a new bulb and a coat of paint.
kindof|kind of funny|wry;droll|adj|neutral|He gave a wry grin at the irony.
kindof|kind of lazy|idle;sluggish|adj|neutral|The idle crew sat around waiting for parts.
kindof|kind of like|resemble;echo|verb|neutral|The twins resemble their grandfather more than either parent.
kindof|kind of mean|snide;catty|adj|casual|She made a snide remark about his shoes.
kindof|kind of old|vintage;dated|adj|neutral|He wore a vintage leather jacket from the seventies.
kindof|kind of sad|wistful;glum|adj|literary|He felt wistful as the ferry pulled away.
kindof|kind of scared|skittish;uneasy|adj|neutral|The skittish horse shied at every shadow along the lane.
kindof|kind of tired|lethargic;sluggish|adj|neutral|The afternoon heat left everyone in the office lethargic.
kindof|kind of want|fancy;feel like|verb|casual|I fancy a walk along the canal before dinner tonight.
kindof|kind of weird|eccentric;odd|adj|neutral|Their eccentric neighbor kept goats on the roof.
kindof|sort of agree|concede;accept|verb|neutral|I concede that the plan has some merit.
kindof|sort of boring|humdrum;bland|adj|neutral|It was a humdrum week with no news at all.
kindof|sort of cold|aloof;distant|adj|neutral|The aloof cat ignored the guests and slept on the piano.
kindof|sort of happy|content;satisfied|adj|neutral|She was content to read by the fire all evening.
kindof|sort of know|suspect;sense|verb|neutral|I suspect the store is already closed for the holiday.
kindof|sort of pale|wan;pallid|adj|literary|She looked wan and thin after the long illness.
kindof|sort of quiet|reticent;reserved|adj|formal|The reticent witness gave short answers to every question.
kindof|sort of rude|curt;brusque|adj|neutral|Her curt reply ended the conversation before it really started.
kindof|sort of shy|bashful;diffident|adj|neutral|The bashful toddler hid behind her father's legs at the party.
kindof|sort of sick|queasy;nauseous|adj|neutral|The smell of fuel on the ferry made me queasy.
kindof|sort of smart|savvy;shrewd|adj|casual|A savvy shopper waits for the sales before buying a coat.
kindof|sort of strange|uncanny;eerie|adj|neutral|There was an uncanny likeness between the two portraits.
alot|a lot of anger|fury;rage;wrath|noun|neutral|The fury of the crowd surprised the officials.
alot|a lot of detail|minutiae;intricacy|noun|formal|The lawyer went through the minutiae of the contract.
alot|a lot of energy|vigor;vitality;zeal|noun|neutral|The new coach brought vigor to the team.
alot|a lot of fun|blast;riot|noun|casual|The party was a blast from start to finish.
alot|a lot of light|glare;blaze|noun|neutral|The glare off the water hurt my eyes.
alot|a lot of money|fortune;windfall|noun|neutral|The painting sold for a fortune at auction.
alot|a lot of noise|racket;din;commotion|noun|casual|The racket from the construction site lasted all day.
alot|a lot of people|crowds;throngs;multitudes|noun|neutral|Crowds gathered outside the stadium long before dawn on match day.
alot|a lot of power|clout;might;dominance|noun|casual|The union has a lot of clout in this town.
alot|a lot of questions|barrage;flurry|noun|neutral|The minister faced a barrage of questions from reporters.
alot|a lot of rain|downpour;deluge|noun|neutral|A sudden downpour sent everyone running for cover.
alot|a lot of smoke|plume;cloud;haze|noun|neutral|A black plume rose from the chimney of the old factory.
alot|a lot of time|ages;eons|noun|casual|It took ages to find a parking space.
alot|a lot of trouble|turmoil;chaos;upheaval|noun|neutral|The sudden strike threw the factory into turmoil.
alot|a lot of water|flood;torrent|noun|neutral|The flood reached the second step of the porch.
alot|lots of birds|flock;swarm|noun|neutral|A flock settled on the wires at dusk.
alot|lots of choices|array;assortment;range|noun|neutral|The shop offers an array of teas from around the world.
alot|lots of color|vibrancy;riot|noun|neutral|The vibrancy of the market stalls caught our eye.
alot|lots of fear|dread;terror;panic|noun|neutral|A sense of dread filled the empty house.
alot|lots of food|feast;banquet|noun|neutral|Grandma cooked a feast for the whole family.
alot|lots of ideas|wealth;abundance;profusion|noun|neutral|The workshop produced a wealth of fresh ideas for the park.
alot|lots of mistakes|blunders;errors|noun|neutral|The draft report was full of blunders that the editor caught.
alot|lots of praise|acclaim;accolades|noun|formal|The film won wide acclaim at the festival.
alot|lots of snow|blizzard;snowdrift|noun|neutral|The blizzard closed every road in the county.
alot|lots of stuff|clutter;junk|noun|casual|The garage was full of clutter from three house moves.
alot|lots of things|slew;myriad|noun|casual|A slew of problems surfaced after the update.
alot|lots of work|workload;toil;grind|noun|neutral|Her workload doubled after the merger, so she hired an assistant.
verb|answered quickly|retorted|verb|vivid|That was not my fault, she retorted with a grin.
verb|answered rudely|snapped|verb|neutral|He snapped at every question from the press.
verb|asked humbly|begged;pleaded|verb|vivid|He begged for one more chance.
verb|asked strongly|demanded;urged|verb|neutral|The angry crowd demanded a refund at the box office.
verb|ate a lot|feasted;gorged|verb|vivid|We feasted on crab at the harbor stall.
verb|ate greedily|devoured;gorged|verb|vivid|The hungry teens devoured three pizzas in ten minutes.
verb|ate noisily|munched;chomped|verb|casual|He munched on an apple during the film.
verb|ate quickly|gobbled;wolfed;devoured|verb|vivid|The boys gobbled their pizza before the game.
verb|ate slowly|nibbled;picked|verb|neutral|She nibbled a cracker while she read.
verb|breathed heavily|panted;gasped|verb|neutral|The runners panted at the finish line.
verb|broke completely|shattered;smashed;wrecked|verb|vivid|The vase shattered on the stone floor.
verb|broke slightly|cracked;chipped|verb|neutral|The screen cracked when I dropped my phone.
verb|burned brightly|blazed;flared|verb|vivid|The bonfire blazed on the beach.
verb|burned completely|incinerated|verb|formal|The furnace incinerated the old files.
verb|burned slowly|smoldered;smouldered|verb|vivid|The campfire smoldered until dawn under a blanket of ash.
verb|came in quietly|crept;slipped|verb|neutral|He crept in after midnight with his shoes in his hand.
verb|came quickly|rushed;hurried|verb|neutral|Neighbors rushed to help when the barn caught fire.
verb|changed completely|transformed;overhauled|verb|neutral|The new owners transformed the old mill.
verb|changed slightly|adjusted;tweaked|verb|neutral|She adjusted the mirror before driving.
verb|cleaned thoroughly|scoured;scrubbed|verb|neutral|They scoured the oven until it shone.
verb|climbed quickly|scrambled;scurried|verb|vivid|We scrambled up the rocks to the summit.
verb|climbed with difficulty|clambered|verb|vivid|He clambered over the wall into the orchard.
verb|closed loudly|slammed;banged|verb|vivid|He slammed the laptop shut and left.
verb|cooked slowly|simmered;braised;stewed|verb|neutral|The sauce simmered for two hours.
verb|cried a little|sniffled;teared up|verb|casual|He sniffled during the last scene of the film.
verb|cried loudly|wailed;sobbed;bawled|verb|vivid|The baby wailed through the whole flight.
verb|cried out in pain|yelped;howled|verb|vivid|The dog yelped when I stepped on its paw.
verb|cried quietly|wept;whimpered|verb|literary|She wept quietly at the back of the chapel.
verb|cut finely|sliced;minced;diced|verb|neutral|She sliced the onions thin for the soup.
verb|cut quickly|slashed|verb|vivid|The store slashed prices for the holiday sale.
verb|cut roughly|hacked;chopped|verb|vivid|He hacked through the brambles with a machete.
verb|disliked strongly|loathed;detested;despised|verb|vivid|She loathed early mornings and the sound of the alarm.
verb|drank noisily|slurped|verb|casual|The kids slurped their milkshakes through straws.
verb|drank quickly|gulped;guzzled;downed|verb|vivid|He gulped the water after the race.
verb|drank slowly|sipped|verb|neutral|She sipped her tea and watched the rain.
verb|dried completely|parched;dehydrated|verb|neutral|The summer heat parched the lawns.
verb|dropped quickly|plunged;plummeted|verb|vivid|Shares plunged on the news of the recall.
verb|dropped slowly|subsided;sank|verb|neutral|The flood waters subsided by Friday.
verb|fell heavily|slumped;collapsed|verb|vivid|He slumped into the armchair after work.
verb|fell over|tripped;toppled;tumbled|verb|neutral|She tripped over the garden hose.
verb|fell suddenly|plunged;plummeted|verb|vivid|The temperature plunged overnight and the pond froze solid.
verb|filled completely|packed;crammed;stuffed|verb|neutral|Fans packed the stadium for the derby.
verb|finished completely|completed|verb|neutral|We completed the puzzle on Sunday.
verb|fixed completely|repaired;restored|verb|neutral|The mechanic repaired the brakes in an hour.
verb|fixed quickly|patched|verb|neutral|He patched the tire at the roadside.
verb|flew around|fluttered;hovered|verb|neutral|Moths fluttered around the porch light.
verb|flew low|swooped|verb|vivid|A gull swooped down for my chips.
verb|flew quickly|soared;zoomed|verb|vivid|The jets soared over the stadium.
verb|fought hard|battled;struggled|verb|vivid|Firefighters battled the blaze for hours.
verb|gave away|donated|verb|neutral|We donated the old toys to the shelter.
verb|gave back|returned|verb|neutral|She returned the book a month late.
verb|gave up|quit;surrendered|verb|casual|He quit smoking in March and took up running.
verb|got away|escaped|verb|neutral|The parrot escaped through the open window.
verb|got better|recovered;improved|verb|neutral|She recovered quickly after the surgery.
verb|got bigger|grew;swelled|verb|neutral|The crowd grew as the band played.
verb|got hold of|grabbed;seized|verb|neutral|He grabbed the rope as the boat tipped.
verb|got smaller|shrank;dwindled|verb|neutral|My sweater shrank in the wash.
verb|got worse|deteriorated;declined|verb|formal|His health deteriorated over the winter.
verb|grew quickly|soared;surged;boomed|verb|vivid|Ticket sales soared after the review.
verb|held closely|hugged;embraced|verb|neutral|They hugged at the arrivals gate.
verb|held gently|cradled|verb|literary|He cradled the newborn lamb in his arms.
verb|held tightly|clutched;gripped;clasped|verb|neutral|She clutched her ticket in the long queue.
verb|helped a lot|aided;assisted|verb|formal|Local divers aided the rescue in the flooded cave.
verb|hit hard|struck;pounded;smashed|verb|neutral|The hammer struck the nail clean on the head.
verb|hit lightly|tapped;patted|verb|neutral|He tapped on the window to wake her.
verb|hit repeatedly|pounded;battered;hammered|verb|vivid|The waves pounded the sea wall all night.
verb|hit with the hand|slapped;smacked|verb|neutral|She slapped the table and laughed.
verb|jumped happily|bounced;bounded|verb|vivid|The puppy bounced around the yard.
verb|jumped high|leapt;vaulted|verb|vivid|The deer leapt over the fence.
verb|jumped in fear|flinched;started|verb|neutral|He flinched when the balloon popped.
verb|knocked loudly|pounded;banged;hammered|verb|vivid|Someone pounded on the door at midnight.
verb|laughed loudly|roared;guffawed|verb|vivid|The crowd roared at the comedian's last line.
verb|laughed nervously|tittered;giggled|verb|literary|The class tittered when the teacher tripped.
verb|laughed quietly|chuckled;giggled|verb|neutral|Grandpa chuckled at his own joke.
verb|laughed unkindly|jeered;sneered;scoffed|verb|vivid|The rival fans jeered as he missed the penalty.
verb|left quickly|fled;bolted|verb|vivid|The guests fled when the fire alarm rang.
verb|left secretly|slipped away;sneaked off|phrase|neutral|She slipped away before the speeches.
verb|liked a lot|loved;adored;relished|verb|neutral|The children loved the puppet show.
verb|listened carefully|attended|verb|formal|The class attended to every word.
verb|listened secretly|eavesdropped|verb|neutral|He eavesdropped on the call from the hallway.
verb|looked angrily|glared;scowled|verb|vivid|The librarian glared at the noisy students.
verb|looked around quickly|scanned|verb|neutral|The guard scanned the crowd for trouble.
verb|looked at carefully|examined;scrutinized;inspected|verb|neutral|The jeweler examined the ring under a lamp.
verb|looked dreamily|gazed|verb|literary|He gazed at the sea from the cliff top.
verb|looked for carefully|searched;combed|verb|neutral|Volunteers searched the woods for the lost hiker.
verb|looked hard|squinted;peered|verb|vivid|She squinted at the tiny print on the label.
verb|looked quickly|glanced;peeked|verb|neutral|She glanced at her watch and left.
verb|looked secretly|peeked;peeped|verb|casual|I peeked at the last page of the novel.
verb|looked steadily|stared;gazed|verb|neutral|The child stared at the fireworks without blinking.
verb|looked through quickly|skimmed;browsed|verb|neutral|I skimmed the report on the train.
verb|lost badly|collapsed;crumbled|verb|vivid|The defense collapsed in the second half.
verb|made better|improved;enhanced|verb|neutral|The new lights improved the stage.
verb|made bigger|enlarged;expanded;widened|verb|neutral|The council enlarged the car park.
verb|made smaller|reduced;shrank;trimmed|verb|neutral|The firm reduced its prices in January.
verb|made up|invented;fabricated|verb|neutral|She invented a game for the long drive.
verb|made worse|worsened;aggravated|verb|neutral|The heavy rain worsened the flooding in the lower town.
verb|moved back|retreated;recoiled|verb|neutral|The army retreated across the river.
verb|moved gracefully|glided;floated|verb|literary|The swan glided across the still lake.
verb|moved in a circle|circled;spun;whirled|verb|neutral|Two hawks circled over the field all afternoon.
verb|moved like a snake|slithered|verb|vivid|A grass snake slithered into the weeds.
verb|moved nervously|fidgeted;squirmed|verb|neutral|The students fidgeted during the long assembly.
verb|moved quickly|darted;zipped;whisked|verb|vivid|A lizard darted under the rock.
verb|moved slowly|crawled;inched;crept|verb|vivid|Traffic crawled along the ring road.
verb|moved suddenly|lunged;jolted|verb|vivid|The goalkeeper lunged to his left.
verb|needed badly|required;lacked|verb|formal|The old bridge required urgent repairs after the flood.
verb|opened forcefully|forced;pried|verb|neutral|The firefighters forced the jammed door.
verb|opened quickly|flung|verb|vivid|She flung the curtains open to the morning sun.
verb|played happily|frolicked;romped|verb|vivid|Lambs frolicked in the spring field.
verb|pulled hard|yanked;tugged;wrenched|verb|vivid|He yanked the cord and the engine started.
verb|pulled slowly|dragged;hauled|verb|neutral|They dragged the boat up the shingle.
verb|pushed gently|nudged;prodded|verb|neutral|She nudged the cup closer to the edge.
verb|pushed hard|shoved;thrust|verb|vivid|Someone shoved me off the crowded bus.
verb|ran away|fled;bolted|verb|vivid|The thieves fled before the alarm stopped ringing.
verb|ran lightly|scampered;skipped|verb|vivid|The kitten scampered across the kitchen tiles.
verb|ran quickly|sprinted;dashed;raced|verb|vivid|When the whistle blew, Theo sprinted to the far end of the pitch.
verb|ran slowly|jogged;loped|verb|neutral|The old dog jogged beside us along the canal path.
verb|read carefully|studied;pored|verb|neutral|She studied the contract before signing.
verb|read quickly|skimmed;scanned|verb|neutral|He skimmed the menu and ordered the fish.
verb|rose quickly|surged;shot up|verb|vivid|The river surged after the storm.
verb|said again|repeated;reiterated|verb|neutral|The pilot repeated the warning over the radio.
verb|said angrily|snapped;barked;growled|verb|vivid|He snapped at the waiter and then apologized.
verb|said casually|remarked;mentioned|verb|neutral|She remarked that the train was late again.
verb|said firmly|insisted;declared|verb|neutral|She insisted that the bill was already paid.
verb|said happily|exclaimed;beamed|verb|neutral|We won the raffle, she exclaimed.
verb|said in a high voice|squeaked;squealed|verb|vivid|The mouse squeaked and vanished under the stove.
verb|said loudly|shouted;bellowed;yelled|verb|neutral|The coach shouted the play across the field.
verb|said nervously|stammered;stuttered|verb|neutral|He stammered through his first wedding toast.
verb|said proudly|boasted;bragged|verb|neutral|He boasted about his new car all evening.
verb|said quietly|whispered;murmured|verb|neutral|She whispered the answer so the others would not hear.
verb|said sadly|lamented;sighed|verb|literary|He lamented the closing of the village bakery.
verb|said unclearly|mumbled;muttered|verb|neutral|The boy mumbled something about his homework.
verb|said under one's breath|muttered|verb|neutral|He muttered about the cost of parking.
verb|sang softly|hummed;crooned|verb|neutral|She hummed an old tune while she painted the fence.
verb|sat down heavily|flopped;slumped|verb|casual|I flopped onto the sofa after the shift.
verb|sat lazily|lounged;sprawled|verb|neutral|They lounged by the pool all afternoon.
verb|shone brightly|blazed;glared;dazzled|verb|vivid|The midday sun blazed on the white walls.
verb|shone on and off|flickered;twinkled|verb|neutral|The street lamp flickered all night.
verb|shone softly|glowed;gleamed|verb|literary|Paper lanterns glowed along the riverbank all evening.
verb|shook a little|quivered;wobbled|verb|vivid|The jelly quivered on the plate.
verb|shook with cold|shivered|verb|neutral|We shivered at the bus stop in the sleet.
verb|shook with fear|trembled;quaked|verb|vivid|Her hands trembled as she opened the letter.
verb|showed clearly|demonstrated;revealed|verb|formal|The crash test demonstrated the flaw in the seat belt.
verb|shut loudly|slammed|verb|vivid|The wind slammed the shed door.
verb|slept badly|tossed|verb|neutral|I tossed all night before the exam.
verb|slept deeply|slumbered|verb|literary|The village slumbered under fresh snow.
verb|slept lightly|dozed;napped|verb|neutral|Grandma dozed in her chair after lunch.
verb|smelled bad|stank;reeked|verb|vivid|The fridge stank after the power cut.
verb|smelled carefully|sniffed|verb|neutral|The dog sniffed every post on the walk.
verb|smiled foolishly|simpered|verb|literary|The courtier simpered at the queen.
verb|smiled unkindly|smirked|verb|neutral|He smirked as his opponent dropped the ball.
verb|smiled widely|beamed;grinned|verb|vivid|She beamed when they called her name.
verb|spent carelessly|squandered;wasted|verb|neutral|He squandered his prize on gadgets.
verb|spoke for a long time|droned|verb|vivid|The speaker droned on until the hall emptied.
verb|stared angrily|glared|verb|vivid|She glared at the driver who cut her off.
verb|started again|resumed|verb|formal|Play resumed after the rain, and the crowd cheered.
verb|stood around|lingered;loitered|verb|neutral|Fans lingered outside the stage door.
verb|stood still|froze|verb|vivid|The cat froze when it saw the dog.
verb|stopped for a while|paused|verb|neutral|He paused to catch his breath.
verb|stopped suddenly|halted;froze|verb|neutral|The train halted between stations for twenty minutes.
verb|swam slowly|paddled|verb|neutral|The kids paddled in the shallows.
verb|talked a lot|chattered;rambled;babbled|verb|casual|The kids chattered all the way to the zoo.
verb|talked about|discussed|verb|neutral|We discussed the budget over lunch.
verb|talked quietly|murmured|verb|neutral|The audience murmured as the lights dimmed.
verb|thought about too much|dwelled;brooded|verb|neutral|He dwelled on the mistake for days.
verb|thought carefully|pondered;considered;weighed|verb|neutral|She pondered the offer for a week.
verb|thought deeply|reflected;mused;contemplated|verb|literary|He reflected on his years at sea.
verb|threw away|discarded;scrapped|verb|formal|We discarded the old drafts once the final copy was printed.
verb|threw hard|hurled;flung|verb|vivid|He hurled the javelin past the line.
verb|threw lightly|tossed;lobbed|verb|neutral|She tossed the keys across the table.
verb|tied tightly|lashed;bound|verb|vivid|They lashed the crates to the deck.
verb|told about|informed;notified|verb|formal|The airline informed us of the delay.
verb|told secretly|confided|verb|neutral|She confided her plans to her sister.
verb|took by force|seized;captured|verb|neutral|Rebels seized the radio station in the early hours.
verb|took part|participated|verb|formal|Forty schools participated in the contest.
verb|took quickly|snatched;grabbed|verb|vivid|The gull snatched the sandwich from her hand.
verb|touched gently|stroked;caressed|verb|neutral|He stroked the horse's neck to calm it down.
verb|touched lightly|brushed;grazed|verb|neutral|Her hand brushed mine on the rail.
verb|tried hard|strove;struggled;labored|verb|formal|They strove to finish before the deadline.
verb|turned quickly|whirled;spun;swiveled|verb|vivid|He whirled around at the sound.
verb|used up|exhausted;depleted;spent|verb|formal|The crew exhausted their water by noon.
verb|waited impatiently|fretted;paced|verb|neutral|He fretted by the phone all evening.
verb|walked aimlessly|wandered;roamed;drifted|verb|neutral|We wandered through the old town until dinner.
verb|walked angrily|stormed;stalked|verb|vivid|He stormed out of the room and slammed the door.
verb|walked heavily|stomped;tramped|verb|vivid|The toddler stomped through every puddle on the street.
verb|walked lazily|sauntered;strolled|verb|neutral|They sauntered along the pier, eating ice cream.
verb|walked proudly|strutted;swaggered|verb|vivid|The rooster strutted around the yard at dawn.
verb|walked quickly|strode;hurried;bustled|verb|neutral|She strode into the meeting with the report in hand.
verb|walked quietly|tiptoed;crept|verb|vivid|He tiptoed past the sleeping baby's room.
verb|walked slowly|trudged;ambled;plodded|verb|vivid|We trudged up the hill with our heavy packs.
verb|walked through water|waded|verb|neutral|We waded across the shallow stream.
verb|walked unsteadily|staggered;stumbled;lurched|verb|vivid|After the long swim, she staggered onto the beach.
verb|walked with difficulty|limped;hobbled|verb|neutral|She limped home after twisting her ankle on the trail.
verb|wanted badly|craved;longed;yearned|verb|vivid|After the hike I craved a hot meal.
verb|washed hard|scrubbed;scoured|verb|neutral|We scrubbed the deck before the guests came.
verb|washed quickly|rinsed|verb|neutral|She rinsed the cups and set them out.
verb|watched closely|observed;monitored|verb|neutral|The nurse observed the patient overnight.
verb|watched secretly|spied|verb|neutral|The kids spied on the new neighbors.
verb|went away|departed;left|verb|formal|The ferry departed on time despite the rough sea.
verb|went down|sank;fell;descended|verb|neutral|The sun sank behind the hills.
verb|went in|entered|verb|formal|The jury entered the courtroom at noon.
verb|went over quickly|reviewed;skimmed|verb|neutral|She reviewed her notes before the talk.
verb|went quickly|rushed;hurried|verb|neutral|We rushed to the station after work.
verb|went up|rose;climbed;ascended|verb|neutral|Prices rose again this spring at every shop in town.
verb|won easily|triumphed;cruised|verb|vivid|Our team triumphed in the final.
verb|worked hard|toiled;labored|verb|literary|The miners toiled deep under the hills.
verb|wrote carelessly|scrawled|verb|vivid|Someone scrawled a name on the wall.
verb|wrote quickly|scribbled;jotted|verb|neutral|I scribbled her number on a napkin.
wordy|a great deal of|much|adj|neutral|The new bridge took much effort and money.
wordy|a large number of|many|adj|neutral|Many fans waited outside the hotel.
wordy|a majority of|most|adj|neutral|Most voters in the district backed the plan.
wordy|a number of|several;some|adj|neutral|Several readers wrote in about the article.
wordy|a small number of|a few;few|adj|neutral|Only a few seats are left.
wordy|a sufficient amount of|enough|adj|neutral|We have enough food for the week.
wordy|absolutely essential|essential|adj|neutral|Water is essential on the hike.
wordy|added bonus|bonus|noun|neutral|The view from the room was a bonus.
wordy|advance planning|planning|noun|neutral|Good planning saved the trip from disaster.
wordy|along the lines of|like|prep|casual|We want something like the old logo.
wordy|an adequate number of|enough|adj|neutral|There are enough chairs for everyone.
wordy|are able to|can|verb|neutral|The new trains can reach full speed in minutes.
wordy|as a matter of fact|in fact|adv|neutral|In fact, the bridge is older than the castle.
wordy|as a result of|because of|prep|neutral|The road closed because of ice.
wordy|at all times|always|adv|neutral|Keep your ticket with you always.
wordy|at an early date|soon|adv|neutral|Please reply soon so we can book the hall.
wordy|at that point in time|then|adv|neutral|We lived in a small flat in Leeds then.
wordy|at the end of the day|ultimately;finally|adv|neutral|Ultimately, the choice is yours to make.
wordy|at the present time|now;currently|adv|neutral|The museum is closed now for repairs.
wordy|at this moment in time|now|adv|neutral|I have nothing more to say now.
wordy|at this point in time|now|adv|neutral|We cannot add more staff now.
wordy|basic fundamentals|fundamentals|noun|neutral|The course covers the fundamentals of baking.
wordy|brief summary|summary|noun|neutral|Here is a summary of the plan.
wordy|by means of|by;using|prep|neutral|They crossed the river by ferry.
wordy|by virtue of|by;because of|prep|formal|She won the title by sheer persistence.
wordy|carry out an evaluation of|evaluate|verb|formal|Inspectors will evaluate the school in June.
wordy|circle around|circle|verb|neutral|Vultures circle the valley at noon.
wordy|close proximity|proximity;nearness|noun|formal|The proximity of the sea keeps the town mild.
wordy|collaborate together|collaborate|verb|neutral|The two labs collaborate on the study.
wordy|combine together|combine|verb|neutral|Combine the flour and the butter.
wordy|come to a conclusion|conclude|verb|formal|The panel will conclude its review in May.
wordy|completely finished|finished|adj|neutral|The mural on the library wall is finished.
wordy|conduct an investigation|investigate|verb|formal|The police will investigate the fire.
wordy|despite the fact that|although;though|conj|neutral|He finished the race although his knee hurt.
wordy|due to the fact that|because;since|conj|neutral|We left early because the forecast called for snow.
wordy|during the course of|during|prep|neutral|During the long flight, he slept for hours.
wordy|each and every|every;each|adj|neutral|Every guest got a candle at the door.
wordy|end result|result|noun|neutral|The result was a cleaner river.
wordy|exact same|same|adj|casual|We wore the same shirt to the party.
wordy|final outcome|outcome|noun|neutral|The outcome of the vote surprised everyone.
wordy|first and foremost|first|adv|neutral|First, thank you all for coming tonight.
wordy|for all intents and purposes|in effect;virtually|adv|neutral|In effect, the deal is done.
wordy|for the purpose of|for;to|prep|neutral|The room is used for storage.
wordy|for the reason that|because|conj|neutral|She chose the job because it was close to home.
wordy|free gift|gift|noun|neutral|Every buyer gets a gift with the first order.
wordy|future plans|plans|noun|neutral|What are your plans after school?
wordy|general consensus|consensus|noun|neutral|The consensus was to wait another week.
wordy|give a description of|describe|verb|neutral|Can you describe the man you saw?
wordy|give an explanation|explain|verb|neutral|Please explain the delay to the passengers.
wordy|give an indication of|indicate;show|verb|formal|The data indicate a slow recovery.
wordy|give approval to|approve|verb|formal|The council will approve the plan.
wordy|give assistance to|help;assist|verb|neutral|Staff will help passengers with bags.
wordy|give consideration to|consider|verb|neutral|Please consider the offer carefully before you reply.
wordy|give encouragement to|encourage|verb|neutral|Coaches should encourage young players after a loss.
wordy|has the ability to|can|verb|neutral|This app can translate signs in real time.
wordy|have a discussion|discuss|verb|neutral|We should discuss the schedule before Monday.
wordy|have the ability to|can|verb|neutral|Owls can turn their heads a long way.
wordy|hold a meeting|meet|verb|neutral|The committee will meet on Tuesday.
wordy|in a careful manner|carefully|adv|neutral|Lift the box carefully, the glass is fragile.
wordy|in a quick manner|quickly|adv|neutral|The crew cleared the stage quickly.
wordy|in a timely manner|promptly|adv|formal|Please reply promptly to the invitation.
wordy|in addition to|besides;plus|prep|neutral|Besides the cake, there was fruit.
wordy|in an attempt to|to|prep|neutral|He ran to catch the bus.
wordy|in an effective manner|effectively|adv|neutral|The new drug works effectively against the virus.
wordy|in close proximity to|near|prep|neutral|The hotel is near the station.
wordy|in excess of|more than;over|prep|neutral|The bridge carries more than ten thousand cars a day.
wordy|in light of the fact that|since;because|conj|neutral|Since the shop is closed, we will cook at home.
wordy|in many cases|often|adv|neutral|Small leaks often cause big bills.
wordy|in most cases|usually|adv|neutral|The bus usually arrives on time.
wordy|in my personal opinion|i think|phrase|casual|I think the sequel was better.
wordy|in order to|to|prep|neutral|We left at dawn to beat the traffic.
wordy|in reference to|about|prep|neutral|I am calling about the flat for rent.
wordy|in regard to|about;regarding|prep|neutral|We have news about the trip.
wordy|in relation to|about;on|prep|neutral|The report says little about costs.
wordy|in some cases|sometimes|adv|neutral|Sometimes the trains run late on Sundays.
wordy|in spite of|despite|prep|neutral|We played the final despite the rain.
wordy|in spite of the fact that|although;though|conj|neutral|Although it was cold, we swam in the lake.
wordy|in terms of|in;for|prep|neutral|The car is cheap to run in fuel costs.
wordy|in the absence of|without|prep|neutral|We cannot proceed without a signature.
wordy|in the event of|if;during|prep|neutral|Use the stairs if there is a fire.
wordy|in the event that|if|conj|neutral|If it rains, the picnic moves indoors.
wordy|in the near future|soon|adv|neutral|We will open a second shop soon.
wordy|in the process of|currently;now|adv|neutral|We are currently moving offices across town.
wordy|in the vicinity of|near;around|prep|neutral|Police found the car near the docks.
wordy|in this day and age|today;now|adv|neutral|Few people write letters by hand today.
wordy|is able to|can|verb|neutral|She can read three languages and speak two.
wordy|is aware of the fact that|knows|verb|neutral|She knows the shop closes early.
wordy|is dependent on|depends on|verb|neutral|The size of the harvest depends on rain.
wordy|is in need of|needs|verb|neutral|The church roof needs repair before winter.
wordy|is indicative of|indicates;shows|verb|formal|The red rash indicates an allergy to nuts.
wordy|it is clear that|clearly|adv|neutral|Clearly, the plan needs more work.
wordy|it is important to note that|note that|phrase|neutral|Note that the gate locks at six.
wordy|it is possible that|may;might|verb|neutral|The shop may close early today.
wordy|it should be noted that|note that|phrase|neutral|Note that parking is free on Sundays.
wordy|join together|join|verb|neutral|The two streams join below the mill.
wordy|make a comparison|compare|verb|neutral|Let us compare the two plans.
wordy|make a contribution|contribute|verb|neutral|Everyone can contribute an idea at the workshop.
wordy|make a decision|decide|verb|neutral|We must decide on the venue by Friday.
wordy|make a payment|pay|verb|neutral|You can pay online or at the front desk.
wordy|make a purchase|buy|verb|neutral|You can buy tickets at the door.
wordy|make a recommendation|recommend|verb|formal|The board will recommend a new chair.
wordy|make a reference to|mention;cite|verb|neutral|The speaker did not mention the strike.
wordy|make a statement|state;say|verb|formal|The witness will state her name.
wordy|make a suggestion|suggest|verb|neutral|May I suggest the soup of the day?
wordy|make an assumption|assume|verb|neutral|Do not assume the bus will be late.
wordy|make an attempt|try;attempt|verb|neutral|We will try to call you tomorrow.
wordy|make an effort|try;strive|verb|neutral|Try to arrive on time for the briefing.
wordy|make an improvement|improve|verb|neutral|The update will improve battery life.
wordy|make an inquiry|ask;inquire|verb|neutral|I called to ask about the job.
wordy|make changes to|change;revise|verb|neutral|We need to change the menu.
wordy|merge together|merge|verb|neutral|The two lanes merge after the bridge.
wordy|needless to say|of course|adv|neutral|Of course, the cake vanished in minutes.
wordy|new innovation|innovation|noun|neutral|The innovation cut costs in half.
wordy|on a daily basis|daily|adv|neutral|We back up the files daily.
wordy|on a few occasions|sometimes;occasionally|adv|neutral|We sometimes eat on the balcony.
wordy|on a monthly basis|monthly|adv|neutral|Rent is paid monthly on the first of the month.
wordy|on a regular basis|regularly|adv|neutral|Check the tire pressure regularly before long trips.
wordy|on a weekly basis|weekly|adv|neutral|The design team meets weekly to review progress.
wordy|on account of the fact that|because|conj|neutral|He stayed in because his car would not start.
wordy|on the grounds that|because|conj|neutral|He refused because the pay was too low.
wordy|on the subject of|about|prep|neutral|She gave a talk about bees.
wordy|owing to the fact that|because;since|conj|neutral|The match stopped because the floodlights failed.
wordy|past history|history|noun|neutral|Her history with the club is long.
wordy|perform an analysis of|analyze|verb|formal|The lab will analyze the samples.
wordy|period of time|period;time|noun|neutral|The loan covers a short period.
wordy|personal friend|friend|noun|neutral|She is a friend of the mayor.
wordy|plan ahead|plan|verb|neutral|We plan every trip in detail.
wordy|postpone until later|postpone|verb|neutral|We had to postpone the party.
wordy|prior to|before|prep|neutral|Wash your hands before dinner, please.
wordy|provide assistance to|help;assist|verb|neutral|Volunteers help families clean up after floods.
wordy|reach a conclusion|conclude|verb|formal|We did not conclude anything at the meeting.
wordy|reach an agreement|agree|verb|neutral|The two sides agree on most points.
wordy|refer back|refer|verb|neutral|Please refer to page ten for the map.
wordy|regardless of the fact that|although|conj|neutral|Although the rules changed, the price stayed the same.
wordy|repeat again|repeat|verb|neutral|Could you repeat the question, please?
wordy|return back|return|verb|neutral|We return from the coast on Sunday.
wordy|revert back|revert|verb|formal|The settings revert after a restart.
wordy|so as to|to|prep|neutral|We whispered to avoid waking the baby.
wordy|still remains|remains|verb|neutral|The question of funding remains open.
wordy|subsequent to|after|prep|neutral|After the merger, the office moved.
wordy|sum total|total|noun|neutral|The total came to forty dollars.
wordy|take action|act|verb|neutral|We must act before the river floods.
wordy|take into consideration|consider|verb|neutral|We must consider the weather before we sail.
wordy|the fact that|that|conj|neutral|I like that the cafe opens early.
wordy|the majority of|most|adj|neutral|Most guests left the party before midnight.
wordy|the reason is because|because|conj|neutral|We moved because the rent went up.
wordy|the reason why is because|because|conj|neutral|I was late because the bus broke down.
wordy|there is a chance that|might;may|verb|neutral|It might snow tonight in the hills.
wordy|throughout the entire|throughout|prep|neutral|It rained throughout the festival weekend.
wordy|true facts|facts|noun|neutral|Check the facts before you publish.
wordy|unexpected surprise|surprise|noun|neutral|The visit was a lovely surprise.
wordy|until such time as|until|conj|neutral|Stay here until the rain stops.
wordy|very unique|unique;singular|adj|neutral|Every snowflake grows a unique pattern of arms and branches.
wordy|whether or not|whether|conj|neutral|Tell me whether you can come.
wordy|with regard to|about;regarding|prep|neutral|I wrote to the council about the potholes.
wordy|with respect to|about;on|prep|neutral|She asked the bank about the fees.
wordy|with the exception of|except|prep|neutral|Everyone came to the picnic except Sam.
wordy|with the purpose of|to|prep|neutral|She came to Paris to study art.
`;

export const PHRASES = parse(RAW);
