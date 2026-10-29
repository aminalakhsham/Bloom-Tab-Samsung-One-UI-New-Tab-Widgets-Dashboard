// "Sort by: Aisle" for shopping lists (ported from Liquid Tab's reminders/grocery.js, English and Arabic words):
// on-device keyword matching, the longest matching word wins ("peanut butter" → Pantry, not Dairy). Words use "_" for
// spaces; Latin words match at the start of a word, so "apple" also finds "apples"; Arabic words match anywhere.

export const AISLES = ['produce', 'bakery', 'dairy', 'meat', 'seafood', 'deli', 'frozen', 'pantry', 'breakfast', 'snacks', 'beverages', 'household', 'personal', 'baby', 'pets'];

const W = {
  produce: `apple banana orange lemon lime grape strawberr blueberr raspberr cherr peach pear plum mango pineapple melon watermelon kiwi avocado tomato potato onion garlic ginger carrot lettuce spinach kale cabbage broccoli cauliflower cucumber zucchini pepper chili celery mushroom corn pea bean_sprout green_bean herb basil parsley cilantro coriander mint dill salad fruit vegetable veggie berr fig date pomegranate eggplant aubergine
    تفاح موز برتقال ليمون عنب فراولة خوخ كمثرى مانجو أناناس اناناس بطيخ شمام كيوي أفوكادو افوكادو طماطم بندورة بطاطس بطاطا بصل ثوم زنجبيل جزر خس سبانخ ملفوف كرنب بروكلي قرنبيط زهرة خيار كوسا فلفل كرفس فطر مشروم ذرة بقدونس كزبرة نعناع شبت سلطة فواكه فاكهة خضار خضروات تمر رمان باذنجان كرز مشمش`,
  bakery: `bread baguette bagel bun roll croissant muffin cake pita tortilla wrap loaf brioche donut doughnut pastr cupcake pie
    خبز عيش صمون كرواسون كعك كيك فطائر توست`,
  dairy: `milk cheese butter yogurt yoghurt cream egg sour_cream cottage mozzarella cheddar parmesan feta ricotta kefir labneh ghee
    حليب لبن جبن جبنة زبدة زبادي روب قشطة قشدة بيض لبنة سمنة`,
  meat: `chicken beef pork lamb mutton turkey bacon sausage ham steak mince ground_beef meat veal ribs wings breast thigh hot_dog salami
    دجاج فراخ لحم لحمة لحوم خروف ضأن ديك_رومي نقانق سجق ستيك كفتة مفروم كبدة`,
  seafood: `fish salmon tuna shrimp prawn crab lobster cod tilapia sardine mussel clam oyster squid octopus seafood
    سمك سلمون تونة جمبري روبيان قريدس كابوريا سلطعون كاليماري أخطبوط`,
  deli: `hummus olive pickle deli dip
    حمص زيتون مخلل`,
  frozen: `frozen ice_cream ice_cube popsicle pizza fries nugget
    مجمد مثلجات آيس_كريم ايس_كريم بيتزا`,
  pantry: `rice pasta spaghetti noodle flour sugar salt oil olive_oil vinegar honey jam peanut_butter sauce ketchup mayo mustard soup can lentil chickpea bean spice cumin cinnamon paprika yeast baking stock broth tomato_paste
    أرز رز معكرونة مكرونة باستا شعيرية دقيق طحين سكر ملح زيت خل عسل مربى صلصة كاتشب مايونيز شوربة عدس حمص_حب فول فاصوليا بهارات كمون قرفة خميرة معلبات`,
  breakfast: `cereal oat oatmeal granola muesli pancake syrup cornflake
    حبوب_الإفطار شوفان كورن_فليكس`,
  snacks: `chips crisps cookie biscuit cracker chocolate candy sweets nuts almond peanut popcorn pretzel gum snack dessert
    شيبس رقائق بسكويت شوكولاتة شوكولا حلوى حلويات مكسرات لوز فول_سوداني فشار علكة`,
  beverages: `water juice soda cola coffee tea beer wine sparkling lemonade kombucha energy_drink
    مياه ماء عصير صودا كولا بيبسي قهوة شاي مشروب`,
  household: `paper_towel toilet_paper tissue napkin detergent soap_dish dish_soap bleach sponge trash_bag garbage_bag foil plastic_wrap battery light_bulb cleaner laundry softener toilet_roll
    مناديل ورق_تواليت منظف صابون_صحون كلور مبيض إسفنج اسفنج أكياس_قمامة ورق_ألمنيوم بطاريات غسيل`,
  personal: `shampoo conditioner toothpaste toothbrush soap deodorant razor lotion sunscreen vitamin medicine pills aspirin ibuprofen bandage floss tampon cotton_pad
    شامبو بلسم معجون_أسنان فرشاة_أسنان صابون مزيل_عرق شفرة كريم واقي_شمس فيتامين دواء أدوية مسكن بنادول`,
  baby: `diaper nappy wipes formula baby
    حفاضات بامبرز مناديل_مبللة حليب_أطفال رضيع`,
  pets: `dog_food cat_food cat_litter pet treats kibble
    طعام_القطط طعام_الكلاب رمل_القطط`,
};

const fold = (s) => s.toLowerCase().normalize('NFC').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
const LATIN = /^[a-z' -]+$/;
// longest first, so "peanut butter" is tried before "butter"
const WORDS = Object.entries(W).flatMap(([cat, s]) => s.split(/\s+/).filter(Boolean).map((w) => [fold(w.replace(/_/g, ' ')), cat])).sort((a, b) => b[0].length - a[0].length);

/** The aisle an item belongs in ("2 avocados" → 'produce'), or '' when nothing matches. */
export function aisleOf(title) {
  const s = ' ' + fold(String(title || '')).replace(/[.,;:!?()]/g, ' ') + ' ';
  for (const [w, cat] of WORDS) if (LATIN.test(w) ? s.includes(' ' + w) : s.includes(w)) return cat;
  return '';
}
